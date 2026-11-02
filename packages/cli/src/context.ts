import type { Answers, Diagnostic, Envelope, ErrorCode, ErrorInfo, Plan, Project, WireDiagnostic } from '@x18n/core'
import type { LoadedProject, Workspace } from '@x18n/node'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { applyTextEdits, envelope, errors, isX18nError, toWireDiagnostic, toWireRange } from '@x18n/core'
import { loadWorkspace, stderrLogger } from '@x18n/node'

export interface GlobalOptions {
  readonly root?: string | undefined
  readonly config?: string | undefined
  readonly project?: string | undefined
  readonly json?: boolean | undefined
  readonly cache?: boolean | undefined
  readonly yes?: boolean | undefined
}

export const cwd = (): string => process.cwd()

export function useColor(options: GlobalOptions): boolean {
  if (options.json || process.env.NO_COLOR)
    return false
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0')
    return true
  return process.stdout.isTTY === true
}

export async function openWorkspace(options: GlobalOptions): Promise<Workspace> {
  return loadWorkspace({
    cwd: options.root ?? cwd(),
    configFile: options.config,
    upward: options.root === undefined,
    project: options.project,
    cache: options.cache !== false,
    logger: stderrLogger,
  })
}

/** Write commands work on one project; a monorepo needs `--project`. */
export function singleProject(workspace: Workspace): LoadedProject {
  if (workspace.projects.length !== 1) {
    throw errors.X18N0003({
      name: undefined,
      available: workspace.projects.map(p => p.name),
    })
  }
  return workspace.projects[0]!
}

export function displayPath(root: string, path: string): string {
  return relative(cwd(), join(root, path)).replace(/\\/g, '/') || '.'
}

export function out(text: string): void {
  process.stdout.write(text.endsWith('\n')
    ? text
    : `${text}\n`)
}

export function printJson<T>(command: string, data: T, diagnostics: readonly WireDiagnostic[] = [], errors: readonly ErrorInfo[] = []): void {
  const value: Envelope<T> = envelope(command, data, diagnostics, errors)
  out(JSON.stringify(value, null, 2))
}

export function wireDiagnostics(loaded: LoadedProject, diagnostics: readonly Diagnostic[]): WireDiagnostic[] {
  return diagnostics.map(d => toWireDiagnostic(loaded.name, d, path => loaded.project.text(path)))
}

/** Exit code for an error code: 2 usage or config, 3 decision needed, 4 stale plan, 1 otherwise. */
/** File, line and column (1-based) of an offset range. */
export function locate(loaded: LoadedProject, path: string, start: number, end: number): { file: string, line: number, column: number } {
  const range = toWireRange(loaded.project.text(path), start, end)
  return {
    file: displayPath(loaded.root, path),
    line: range.line,
    column: range.column,
  }
}

export function exitCodeFor(code: ErrorCode): number {
  if (code === 'X18N4003')
    return 3
  if (code === 'X18N4004')
    return 4
  return /^X18N[01]/.test(code)
    ? 2
    : 1
}

/** Errors without an x18n code exit with 2. */
export function exitCodeOf(error: unknown): number {
  return isX18nError(error)
    ? exitCodeFor(error.code)
    : 2
}

/** Stands for a lone `-` argument (stdin). */
export const stdinArg = '\u0000stdin'

export async function readInput(source: string): Promise<string> {
  if (source !== '-' && source !== stdinArg)
    return readFile(source, 'utf8')
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin)
    chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/** Answers for the plan's decisions: defaults with `--yes`, a prompt in a TTY, else an error. */
async function answer(plan: Plan, options: GlobalOptions): Promise<Answers> {
  const answers: Record<string, string> = {}
  if (plan.decisions.length === 0)
    return answers
  if (options.yes) {
    for (const decision of plan.decisions)
      answers[decision.id] = decision.default
    return answers
  }
  if (options.json || !process.stdin.isTTY) {
    throw errors.X18N4003({
      decisions: plan.decisions.map(d => `${d.message} (${d.options.map(o => o.id).join(' | ')})`),
    })
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    for (const decision of plan.decisions) {
      process.stderr.write(`${decision.message}\n${decision.options.map((o, i) => `  ${i + 1}) ${o.label}`).join('\n')}\n`)
      const reply = await rl.question(`Choose [1]: `)
      const option = decision.options[Number(reply || '1') - 1] ?? decision.options[0]!
      answers[decision.id] = option.id
    }
  }
  finally {
    rl.close()
  }
  return answers
}

/** Changes as a small line diff, for `--dry-run` and the summary after a write. */
function formatPlan(project: Project, root: string, plan: Plan): string {
  const lines: string[] = []
  for (const change of plan.changes) {
    const path = displayPath(root, change.path)
    if (change.type === 'create') {
      lines.push(`create ${path}`, ...change.content.split('\n').filter(Boolean).map(line => `+ ${line}`))
      continue
    }
    if (change.type === 'delete') {
      lines.push(`delete ${path}`)
      continue
    }
    const before = project.text(change.path) ?? ''
    const after = applyTextEdits(before, change.edits)
    const a = before.split('\n')
    const b = after.split('\n')
    let start = 0
    while (start < a.length && start < b.length && a[start] === b[start])
      start++
    let endA = a.length
    let endB = b.length
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA--
      endB--
    }
    lines.push(`edit ${path}`, ...a.slice(start, endA).map(line => `- ${line}`), ...b.slice(start, endB).map(line => `+ ${line}`))
  }
  for (const warning of plan.warnings)
    lines.push(`warning: ${warning}`)
  return lines.length
    ? lines.join('\n')
    : 'No changes.'
}

function planData(root: string, plan: Plan, applied: boolean): object {
  return {
    applied,
    keys: plan.keys,
    warnings: plan.warnings,
    decisions: plan.decisions,
    changes: plan.changes.map(change => ({
      ...change,
      file: displayPath(root, change.path),
    })),
  }
}

/** What a command prints instead of the line diff, and adds to the JSON `data`. */
export interface PlanReport {
  readonly data: object
  readonly text: (applied: boolean) => string
}

/** Plans, asks, then applies (or prints with `--dry-run`). */
export async function runPlan(command: string, loaded: LoadedProject, plan: Plan, options: GlobalOptions & { readonly dryRun?: boolean | undefined }, report?: PlanReport): Promise<void> {
  const print = (applied: boolean, preview: string): void => {
    if (options.json) {
      printJson(command, {
        ...planData(loaded.root, plan, applied),
        ...report?.data,
      })
    }
    else {
      out(report
        ? report.text(applied)
        : preview)
    }
  }
  if (options.dryRun) {
    print(false, report
      ? ''
      : formatPlan(loaded.project, loaded.root, plan))
    return
  }
  const answers = await answer(plan, options)
  const preview = report
    ? ''
    : formatPlan(loaded.project, loaded.root, plan)
  await loaded.project.apply(plan, { answers })
  print(true, preview)
}
