import type { ResolvedConfig } from '../types/config'
import type { EditOp, KeyString, LocaleCode } from '../types/model'
import type { Project } from '../types/project'
import type { ApprovalPlan, ApprovalQuery, ApprovalSkip, ApprovalSkipReason, MachineRecord } from '../types/review'
import { errors } from '../errors'
import { keyMatcher } from '../keys'
import { createPlaceholderComparer } from './batch'
import { valueText } from './reviews'

export interface ApprovalDeps {
  readonly project: Project
  readonly config: ResolvedConfig
  readonly machine: (key: KeyString, locale: LocaleCode) => MachineRecord | undefined
}

const at = (key: KeyString, locale: LocaleCode): string => `${key}\u0000${locale}`

function isNarrowed(query: ApprovalQuery): boolean {
  return query.glob !== undefined
    || query.namespace !== undefined
    || (query.machine !== undefined && query.machine !== false)
    || query.state !== undefined
    || query.thread !== undefined
    || query.values !== undefined
}

/** The target locales of a query: every locale but the source by default. */
function localesOf(project: Project, query: ApprovalQuery): LocaleCode[] {
  const source = project.sourceLocale
  const locales = query.locales === undefined || query.locales === 'all'
    ? project.locales
    : query.locales
  const unknown = locales.find(locale => !project.locales.includes(locale))
  if (unknown !== undefined)
    throw errors.X18N4008({ reason: `unknown locale "${unknown}"` })
  return locales.filter(locale => locale !== source)
}

/** True when a value breaks the placeholders or the syntax of its source. */
function failsChecks(project: Project): (value: string, source: string) => boolean {
  const compare = createPlaceholderComparer(project.placeholderSyntaxes)
  return (value, source) => {
    const { missing, extra } = compare(source, value)
    if (missing.length > 0 || extra.length > 0)
      return true
    return project.placeholderSyntaxes.some((syntax) => {
      const known = new Set(syntax.validate?.(source))
      return (syntax.validate?.(value) ?? []).some(problem => !known.has(problem))
    })
  }
}

interface Selected {
  readonly key: KeyString
  readonly locale: LocaleCode
  readonly machine: MachineRecord | undefined
}

/** Whether the filters of a query select a message. A message they leave out is not a skip. */
function selects(deps: ApprovalDeps, query: ApprovalQuery, key: KeyString, locale: LocaleCode): Selected | undefined {
  const { project } = deps
  const machine = deps.machine(key, locale)
  if (query.machine !== undefined && query.machine !== false && (!machine || (typeof query.machine === 'string' && machine.translator !== query.machine)))
    return undefined
  if (query.state !== undefined && project.message(key, locale)?.state !== query.state)
    return undefined
  if (query.thread !== undefined && project.reviews({ key, locale, open: true })[0]?.state !== query.thread)
    return undefined
  return { key, locale, machine }
}

interface SkipContext {
  readonly seen: ReadonlyMap<string, string> | undefined
  readonly outdated: ReadonlyMap<LocaleCode, ReadonlySet<KeyString>>
  readonly fails: (value: string, source: string) => boolean
}

/** Why a selected message is not approved, or undefined to approve it. */
function skipReason(project: Project, query: ApprovalQuery, message: Selected, value: string | undefined, ctx: SkipContext): ApprovalSkipReason | undefined {
  const { key, locale } = message
  if (value === undefined || value === '')
    return 'empty'
  if (ctx.seen && ctx.seen.get(at(key, locale)) !== value)
    return 'value-changed'
  const resource = project.message(key, locale)?.resource
  if (project.resources.find(r => r.id === resource)?.readonly)
    return 'read-only'
  const thread = project.reviews({ key, locale, open: true })[0]
  if (thread?.comments.some(c => c.type === 'approve' && c.value === value))
    return 'already-approved'
  if (thread?.state === 'changes-requested' && !query.overrideChangeRequests)
    return 'changes-requested'
  if (ctx.outdated.get(locale)?.has(key) && (query.stale ?? 'skip') === 'skip')
    return 'stale'
  const source = project.message(key, project.sourceLocale)?.value
  return typeof source === 'string' && ctx.fails(value, source)
    ? 'failing-check'
    : undefined
}

interface Collected {
  readonly approved: ApprovalPlan['approved'][number][]
  readonly skipped: ApprovalSkip[]
  readonly ops: EditOp[]
  readonly limit: number
}

/** Approves a selected message, or records why not. */
function consider(deps: ApprovalDeps, query: ApprovalQuery, ctx: SkipContext, message: Selected | undefined, out: Collected): void {
  if (!message)
    return
  const { key, locale } = message
  const current = deps.project.message(key, locale)?.value
  const value = current === undefined
    ? undefined
    : valueText(current)
  const reason = skipReason(deps.project, query, message, value, ctx) ?? (out.approved.length >= out.limit
    ? 'limit'
    : undefined)
  if (reason !== undefined || value === undefined) {
    out.skipped.push({ key, locale, reason: reason ?? 'empty' })
    return
  }
  out.approved.push({
    key,
    locale,
    value,
    machine: message.machine?.translator,
  })
  out.ops.push({
    type: 'review',
    key,
    locale,
    review: 'approve',
    ...query.text !== undefined && { text: query.text },
    ...query.author && { author: query.author },
  })
  if (query.stale === 'mark-fresh' && ctx.outdated.get(locale)?.has(key)) {
    out.ops.push({
      type: 'mark-fresh',
      key,
      locales: [locale],
    })
  }
}

/** Plans one approval per selected message, with the skips that say why the others are left alone. */
export function planApprovals(deps: ApprovalDeps, query: ApprovalQuery): ApprovalPlan {
  const { project, config } = deps
  if (!isNarrowed(query))
    throw errors.X18N5006()
  if (project.reviewFile === undefined) {
    throw errors.X18N5003({
      reason: config.review.enabled
        ? 'the review file cannot be read'
        : '`review.enabled` is false',
    })
  }
  const locales = localesOf(project, query)
  const match = query.glob === undefined || query.glob === '**'
    ? undefined
    : keyMatcher([query.glob], config.keySeparator)
  const seen = query.values && new Map(query.values.map(v => [
    at(v.key, v.locale),
    v.value,
  ]))
  const ctx: SkipContext = {
    seen,
    outdated: new Map(project.analyze().coverage.map(c => [
      c.locale,
      new Set(c.outdated),
    ])),
    fails: failsChecks(project),
  }
  const out: Collected = {
    approved: [],
    skipped: [],
    ops: [],
    limit: query.limit ?? Number.POSITIVE_INFINITY,
  }
  const keys = project.keys({ namespace: query.namespace }).filter(key => !match || match(key))
  for (const key of keys) {
    for (const locale of locales) {
      if (!seen || seen.has(at(key, locale)))
        consider(deps, query, ctx, selects(deps, query, key, locale), out)
    }
  }
  return {
    plan: project.plan(out.ops),
    approved: out.approved,
    skipped: out.skipped,
  }
}
