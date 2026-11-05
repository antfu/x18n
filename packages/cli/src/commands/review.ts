import type { ApprovalQuery, EditOp, JsonValue, ReviewAuthor, ReviewType } from '@x18n/core'
import type { GlobalOptions } from '../context'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { errors, isJsonObject } from '@x18n/core'
import { openWorkspace, out, printJson, readInput, runPlan, singleProject } from '../context'

export interface ReviewOptions extends GlobalOptions {
  readonly locale?: string | readonly string[] | undefined
  readonly text?: string | undefined
  readonly value?: string | undefined
  readonly author?: string | undefined
  readonly open?: boolean | undefined
  readonly dryRun?: boolean | undefined
  /** Batch approval filters. */
  readonly namespace?: string | undefined
  /** `true` for a bare `--machine`, else a translator id. */
  readonly machine?: boolean | string | undefined
  readonly state?: string | undefined
  readonly thread?: string | undefined
  readonly from?: string | undefined
  readonly stale?: string | undefined
  readonly overrideChangeRequests?: boolean | undefined
  readonly limit?: number | undefined
}

/** A glob, or any batch filter, makes `approve` a batch approval. */
function isBatch(target: string | undefined, options: ReviewOptions): boolean {
  return (target !== undefined && target.includes('*')) || options.machine !== undefined || options.state !== undefined || options.thread !== undefined || options.from !== undefined || options.namespace !== undefined
}

/** Reads `{ "<locale>": { "<key>": "<value>" } }`, the shape `x18n apply` takes, as the values a reviewer saw. */
async function seenValues(file: string, parseKey: (raw: string) => string): Promise<NonNullable<ApprovalQuery['values']>> {
  const data = JSON.parse(await readInput(file)) as JsonValue
  if (!isJsonObject(data))
    throw errors.X18N4008({ reason: 'expected { "<locale>": { "<key>": "<value>" } }' })
  return Object.entries(data).flatMap(([locale, entries]) => {
    if (!isJsonObject(entries))
      throw errors.X18N4008({ reason: `"${locale}" must map keys to values` })
    return Object.entries(entries).map(([key, value]) => ({
      key: parseKey(key),
      locale,
      value: String(value),
    }))
  })
}

async function batchApprove(target: string | undefined, options: ReviewOptions): Promise<number | void> {
  const loaded = singleProject(await openWorkspace(options))
  const { project } = loaded
  const locales = options.locale === undefined
    ? undefined
    : [options.locale].flat().flatMap(l => String(l).split(',')).map(l => l.trim()).filter(Boolean)
  const stale = options.stale ?? 'skip'
  if (stale !== 'skip' && stale !== 'approve' && stale !== 'mark-fresh')
    throw errors.X18N4008({ reason: `--stale must be skip, approve or mark-fresh, not "${stale}"` })
  if (options.state !== undefined && options.state !== 'needs-review' && options.state !== 'translated')
    throw errors.X18N4008({ reason: `--state must be needs-review or translated, not "${options.state}"` })
  if (options.thread !== undefined && options.thread !== 'suggested' && options.thread !== 'commented' && options.thread !== 'stale-approval')
    throw errors.X18N4008({ reason: `--thread must be suggested, commented or stale-approval, not "${options.thread}"` })
  if (stale === 'mark-fresh' || stale === 'skip')
    await project.loadHistory()
  const approval = project.planApprovals({
    locales,
    glob: target,
    namespace: options.namespace,
    machine: options.machine,
    state: options.state,
    thread: options.thread,
    values: options.from === undefined
      ? undefined
      : await seenValues(options.from, raw => project.parseKey(raw)),
    stale,
    overrideChangeRequests: options.overrideChangeRequests,
    text: options.text === undefined
      ? undefined
      : String(options.text),
    author: options.author === undefined
      ? await project.reviewAuthor()
      : parseAuthor(options.author),
    limit: options.limit === undefined
      ? undefined
      : Number(options.limit),
  })
  const counts = new Map<string, number>()
  for (const skip of approval.skipped)
    counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1)
  const summary = (applied: boolean): string => [
    `${applied
      ? 'Approved'
      : 'Would approve'} ${approval.approved.length} ${approval.approved.length === 1
      ? 'message'
      : 'messages'}${approval.approved.length > 0
      ? ':'
      : '.'}`,
    ...approval.approved.map(a => `  ${a.key}  ${a.locale}  ${JSON.stringify(a.value)}${a.machine
      ? `  (${a.machine})`
      : ''}`),
    ...[...counts].map(([reason, n]) => `  skipped ${n} (${reason})`),
  ].join('\n')
  if (!options.dryRun && !options.yes && !options.json && process.stdin.isTTY && approval.approved.length > 20) {
    process.stderr.write(`${summary(false)}\n`)
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const reply = await rl.question(`Approve ${approval.approved.length} messages? [y/N] `).finally(() => rl.close())
    if (!/^y(?:es)?$/i.test(reply.trim()))
      return 1
  }
  await runPlan('review approve', loaded, approval.plan, options, {
    data: { approved: approval.approved, skipped: approval.skipped },
    text: summary,
  })
}

const commentTypes: Readonly<Record<string, ReviewType>> = {
  'comment': 'comment',
  'approve': 'approve',
  'request-change': 'request-change',
  'suggest': 'suggestion',
}

/** `Ada <ada@example.com>`, `Ada` or `ada@example.com`. */
function parseAuthor(input: string): ReviewAuthor {
  const text = input.trim()
  const open = text.lastIndexOf('<')
  if (open >= 0 && text.endsWith('>')) {
    const name = text.slice(0, open).trim()
    return {
      ...name && { name },
      email: text.slice(open + 1, -1).trim(),
    }
  }
  return text.includes('@')
    ? { email: text }
    : { name: text }
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value === '')
    throw errors.X18N4008({ reason: `pass ${flag}` })
  return String(value)
}

async function list(target: string | undefined, options: ReviewOptions): Promise<void> {
  const workspace = await openWorkspace(options)
  const locale = options.locale === undefined
    ? undefined
    : String([options.locale].flat()[0])
  const projects = workspace.projects.map(({ name, project }) => ({
    name,
    threads: project.reviews({
      key: target === undefined
        ? undefined
        : project.parseKey(target),
      locale,
      open: options.open,
    }),
  }))
  if (options.json) {
    printJson('review list', { projects })
    return
  }
  const threads = projects.flatMap(p => p.threads)
  if (threads.length === 0)
    out(options.open ? 'No open reviews.' : 'No reviews.')
  for (const thread of threads) {
    out(`${thread.key}  ${thread.locale}${thread.state
      ? `  ${thread.state.replace('-', ' ')}`
      : ''}`)
    for (const c of thread.comments) {
      const flags = [
        c.resolved && 'resolved',
        c.stale && 'stale',
      ].filter(Boolean).join(', ')
      out(`  ${c.id}  ${c.type.padEnd(14)} ${c.author?.name ?? c.author?.email ?? '-'}  ${c.time.slice(0, 10)}${flags
        ? `  (${flags})`
        : ''}`)
      if (c.text)
        out(`    ${c.text}`)
      if (c.suggestion !== undefined)
        out(`    suggests ${JSON.stringify(c.suggestion)}`)
    }
  }
}

/** `x18n review <action> [target]`: list, comment, approve, request-change, suggest, resolve, apply-suggestion, mark-fresh. */
export async function review(action: string, target: string | undefined, options: ReviewOptions): Promise<number | void> {
  if (action === 'list')
    return list(target, options)
  if (action === 'approve' && isBatch(target, options))
    return batchApprove(target, options)
  const loaded = singleProject(await openWorkspace(options))
  const { project } = loaded
  const locales = options.locale === undefined
    ? undefined
    : [options.locale].flat().map(String)
  let op: EditOp
  const type = commentTypes[action]
  if (type) {
    const locale = locales?.[0]
    if (locale === undefined)
      throw errors.X18N4008({ reason: 'pass --locale <locale>' })
    op = {
      type: 'review',
      key: project.parseKey(required(target, '<key>')),
      locale,
      review: type,
      text: type === 'request-change'
        ? required(options.text, '--text <text>')
        : options.text === undefined
          ? undefined
          : String(options.text),
      suggestion: type === 'suggestion'
        ? required(options.value, '--value <value>')
        : undefined,
      author: options.author === undefined
        ? await project.reviewAuthor()
        : parseAuthor(options.author),
    }
  }
  else if (action === 'resolve' || action === 'apply-suggestion') {
    op = {
      type: action === 'resolve'
        ? 'resolve-review'
        : 'apply-suggestion',
      id: required(target, '<id>'),
    }
  }
  else if (action === 'mark-fresh') {
    op = {
      type: 'mark-fresh',
      key: project.parseKey(required(target, '<key>')),
      locales,
    }
  }
  else {
    throw errors.X18N4008({ reason: `unknown review action "${action}" (list, comment, approve, request-change, suggest, resolve, apply-suggestion, mark-fresh)` })
  }
  await runPlan(`review ${action}`, loaded, project.plan([op]), options)
}
