import type { BaselineSummary, Diagnostic, FixSummary, Reporter, ReportInput } from '@x18n/core'
import type { LoadedProject, Workspace } from '@x18n/node'
import type { Baseline, Located } from '../baseline'
import type { GlobalOptions } from '../context'
import { writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { errors } from '@x18n/core'
import { applyBaseline, createBaseline, readBaseline, writeBaseline } from '../baseline'
import { answer, cwd, displayPath, formatPlan, openWorkspace, out, useColor } from '../context'

export interface CheckOptions extends GlobalOptions {
  readonly watch?: boolean | undefined
  readonly strict?: boolean | undefined
  readonly locale?: string | readonly string[] | undefined
  readonly only?: string | undefined
  readonly skip?: string | undefined
  readonly maxWarnings?: number | undefined
  readonly reporter?: string | readonly string[] | undefined
  readonly output?: string | readonly string[] | undefined
  readonly baseline?: string | undefined
  readonly updateBaseline?: boolean | undefined
  /** `--fix` applies safe fixes, `--fix=unsafe` also unsafe ones. */
  readonly fix?: boolean | string | undefined
  readonly dryRun?: boolean | undefined
}

function list(value: string | readonly string[] | undefined): string[] {
  return value === undefined
    ? []
    : [value].flat().flatMap(item => String(item).split(',')).map(item => item.trim()).filter(Boolean)
}

// `missing-translation` reports one diagnostic per key at the source locale and names the target locales only in its
// message (`"<key>" is missing in de, pt-BR.`). Baseline entries keep no fixes, so the message is all both paths have.
function missingLocales(message: string): string[] {
  const marker = ' is missing in '
  const at = message.lastIndexOf(marker)
  return at === -1
    ? []
    : message.slice(at + marker.length).replace(/\.$/, '').split(', ')
}

/** Whether this run reports a diagnostic (or a baseline entry), after `--locale`, `--only` and `--skip`. */
function reported(d: { readonly code: string, readonly locale?: string | undefined, readonly message: string }, options: CheckOptions): boolean {
  const locales = list(options.locale)
  const only = list(options.only)
  return (locales.length === 0 || d.locale === undefined || locales.includes(d.locale) || (d.code === 'missing-translation' && missingLocales(d.message).some(l => locales.includes(l))))
    && (only.length === 0 || only.includes(d.code))
    && !list(options.skip).includes(d.code)
}

function filterDiagnostics(diagnostics: readonly Diagnostic[], options: CheckOptions): Diagnostic[] {
  return diagnostics
    .filter(d => reported(d, options))
    .map(d => options.strict && d.severity === 'warning'
      ? { ...d, severity: 'error' as const }
      : d)
}

/** The reported diagnostics of every project, with the path the baseline knows each one by. */
function locate(workspace: Workspace, options: CheckOptions): (Located & { readonly project: LoadedProject })[] {
  return workspace.projects.flatMap((loaded) => {
    const posix = (path: string): string => relative(workspace.root, join(loaded.root, path)).replace(/\\/g, '/') || '.'
    return filterDiagnostics(loaded.project.analyze().diagnostics, options).map(diagnostic => ({
      project: loaded,
      path: posix(diagnostic.location?.path ?? ''),
      diagnostic,
    }))
  })
}

type Fixes = ReadonlyMap<LoadedProject, FixSummary>

function reportInputs(workspace: Workspace, options: CheckOptions, baseline: Baseline | undefined, fixes?: Fixes): { inputs: ReportInput[], summary: BaselineSummary | undefined } {
  const located = locate(workspace, options)
  const applied = baseline && applyBaseline(located, baseline, entry => reported(entry, options))
  const kept = applied?.kept ?? located
  const inputs = workspace.projects.map((loaded: LoadedProject) => {
    const analysis = loaded.project.analyze()
    const diagnostics = kept.filter(item => item.project === loaded).map(item => item.diagnostic)
    return {
      project: loaded.name,
      text: (path: string) => loaded.project.text(path),
      diagnostics,
      coverage: analysis.coverage,
      summary: {
        errors: diagnostics.filter(d => d.severity === 'error').length,
        warnings: diagnostics.filter(d => d.severity === 'warning').length,
        infos: diagnostics.filter(d => d.severity === 'info' || d.severity === 'hint').length,
        files: new Set(diagnostics.flatMap(d => d.location
          ? [d.location.path]
          : [])).size,
      },
      fix: fixes?.get(loaded),
    }
  })
  return { inputs, summary: applied && { suppressed: applied.suppressed, fixed: applied.fixed } }
}

/** History costs a git walk, so it loads only when `stale-translation` runs. */
function needsHistory(loaded: LoadedProject, options: CheckOptions): boolean {
  const setting = loaded.project.config.checks['stale-translation']
  const level = typeof setting === 'string'
    ? setting
    : setting?.[0]
  const only = list(options.only)
  return level !== 'off' && (only.length === 0 || only.includes('stale-translation')) && !list(options.skip).includes('stale-translation')
}

async function report(workspace: Workspace, options: CheckOptions, baseline: Baseline | undefined, fixes?: Fixes): Promise<number> {
  const { inputs, summary } = reportInputs(workspace, options, baseline, fixes)
  const reporterIds = list(options.reporter)
  const ids = reporterIds.length
    ? reporterIds
    : [
        options.json ? 'json' : 'pretty',
      ]
  const outputs = list(options.output)
  const available: ReadonlyMap<string, Reporter> = workspace.projects[0]?.project.reporters ?? new Map()
  const roots = new Map(workspace.projects.map(p => [p.name, p.root]))
  for (const [i, id] of ids.entries()) {
    const reporter = available.get(id)
    if (!reporter) {
      throw errors.X18N0001({ issue: `unknown reporter "${id}" (${[
        ...available.keys(),
      ].join(', ')})` })
    }
    const text = await reporter.report(inputs, {
      color: !outputs[i] && useColor(options) && id === 'pretty',
      displayPath: (path, project) => displayPath(roots.get(project) ?? '', path),
      baseline: summary,
    })
    if (outputs[i])
      await writeFile(outputs[i]!, text)
    else if (text)
      process.stdout.write(text)
  }
  const errorCount = inputs.reduce((sum, input) => sum + input.summary.errors, 0)
  const warnings = inputs.reduce((sum, input) => sum + input.summary.warnings, 0)
  const tooManyWarnings = options.maxWarnings !== undefined && warnings > Number(options.maxWarnings)
  return errorCount > 0 || tooManyWarnings
    ? 1
    : 0
}

/** The baseline file: `--baseline <file>` from the cwd, else `.x18n/check-baseline.json` in the workspace root. */
function baselineFile(workspace: Workspace, options: CheckOptions): string {
  return options.baseline === undefined
    ? join(workspace.root, '.x18n', 'check-baseline.json')
    : resolve(cwd(), String(options.baseline))
}

/**
 * Writes the diagnostics this run reports into the baseline. Entries that `--only`, `--skip` or `--locale` leave
 * out stay as they are.
 */
async function updateBaseline(workspace: Workspace, options: CheckOptions, file: string, previous: Baseline | undefined): Promise<Baseline> {
  const baseline = createBaseline(locate(workspace, options), previous?.diagnostics.filter(entry => !reported(entry, options)))
  await writeBaseline(file, baseline)
  const count = baseline.diagnostics.reduce((sum, entry) => sum + entry.count, 0)
  process.stderr.write(`Wrote ${count} ${count === 1
    ? 'diagnostic'
    : 'diagnostics'} to the baseline ${relative(cwd(), file).replace(/\\/g, '/')}.\n`)
  return baseline
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1
    ? ''
    : 's'}`
}

/** `--fix` or `--fix=unsafe`; anything else is refused before the workspace loads. */
function fixLevel(options: CheckOptions): 'safe' | 'unsafe' | undefined {
  if (options.fix === undefined || options.fix === false) {
    if (options.dryRun)
      throw errors.X18N4008({ reason: '--dry-run previews fixes; pass it with --fix' })
    return undefined
  }
  if (options.fix !== true && options.fix !== 'unsafe')
    throw errors.X18N4008({ reason: `--fix takes no value or "unsafe", not "${String(options.fix)}"` })
  if (options.watch)
    throw errors.X18N4008({ reason: '--fix writes once; leave out --watch' })
  return options.fix === true
    ? 'safe'
    : 'unsafe'
}

/**
 * Plans the fixes of the diagnostics this run reports (after `--locale`, `--only` and `--skip`, before the baseline) and
 * applies them, or prints them with `--dry-run`. The summary goes to stderr, so stdout keeps only the report.
 */
async function fix(workspace: Workspace, options: CheckOptions, level: 'safe' | 'unsafe'): Promise<Fixes> {
  const fixes = new Map<LoadedProject, FixSummary>()
  for (const loaded of workspace.projects) {
    const { plan, fixed, skipped } = loaded.project.planFixes(filterDiagnostics(loaded.project.analyze().diagnostics, options), {
      unsafe: level === 'unsafe',
    })
    const files = plan.changes.map(change => change.path)
    if (!options.dryRun && plan.changes.length > 0)
      await loaded.project.apply(plan, { answers: await answer(plan, options) })
    fixes.set(loaded, {
      applied: !options.dryRun,
      fixed: fixed.length,
      skipped: skipped.length,
      files,
      warnings: plan.warnings,
    })
    if (options.json)
      continue
    const lines: string[] = []
    if (options.dryRun && plan.changes.length > 0)
      lines.push(formatPlan(loaded.project, loaded.root, plan))
    else
      lines.push(...plan.warnings.map(w => `warning: ${w}`))
    const prefix = workspace.projects.length > 1
      ? `${loaded.name}: `
      : ''
    const count = `${plural(fixed.length, 'problem')} in ${plural(files.length, 'file')}`
    lines.push(`${prefix}${fixed.length === 0
      ? 'No problems to fix.'
      : options.dryRun
        ? `Would fix ${count} (dry run).`
        : `Fixed ${count}.`}`)
    if (skipped.length > 0) {
      lines.push(`${prefix}${plural(skipped.length, 'problem')} only ${skipped.length === 1
        ? 'has'
        : 'have'} an unsafe fix; run with --fix=unsafe to apply ${skipped.length === 1
        ? 'it'
        : 'them'}.`)
    }
    process.stderr.write(`${lines.join('\n')}\n`)
  }
  return fixes
}

export async function check(options: CheckOptions): Promise<number> {
  const level = fixLevel(options)
  const workspace = await openWorkspace(options)
  await Promise.all(workspace.projects.filter(loaded => needsHistory(loaded, options)).map(async (loaded) => {
    await loaded.project.loadHistory({ watch: options.watch })
    await loaded.host.flush()
  }))
  const fixes = level && await fix(workspace, options, level)
  const file = baselineFile(workspace, options)
  // An invalid file is no reason to refuse writing a new one.
  let baseline = await readBaseline(file).catch((error: unknown) => {
    if (options.updateBaseline)
      return undefined
    throw error
  })
  if (options.updateBaseline)
    baseline = await updateBaseline(workspace, options, file, baseline)
  const code = await report(workspace, options, baseline, fixes)
  if (!options.watch)
    return code
  const rerun = async (): Promise<void> => {
    if (process.stdout.isTTY)
      process.stdout.write('\u001Bc')
    out(`[${new Date().toLocaleTimeString()}] File change detected. Checking...\n`)
    await report(workspace, options, baseline)
  }
  for (const loaded of workspace.projects) {
    loaded.project.watch()
    loaded.project.onChange(() => void rerun())
  }
  out('\nWatching for file changes.')
  return new Promise(() => {})
}
