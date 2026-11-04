import type { Answers, Diagnostic, EditOp, KeyString, LineIndex, LocaleCode, LocaleCoverage, MessageChange, MessageState, Plan, ReviewState, Usage, UsageMatch, WireDiagnostic } from '@x18n/core'
import type { AnalysisView, ApplyView, ExplainView, HistoryView, KeyDetail, KeyTable, PlanView, ProjectSummary, Snippet, UiProject, UnusedDeletionQuery, UnusedDeletionView, UsageView } from './types'
import { createLineIndex, errors, placeholderProblems, toWireDiagnostic } from '@x18n/core'

/** The named project, or the only one. */
export function pickProject(projects: readonly UiProject[], name: string | undefined): UiProject {
  const found = name === undefined
    ? (projects.length === 1
        ? projects[0]
        : undefined)
    : projects.find(p => p.name === name)
  if (!found) {
    throw errors.X18N0003({
      name,
      available: projects.map(p => p.name),
    })
  }
  return found
}

function percent(coverage: LocaleCoverage): number {
  return coverage.total === 0
    ? 100
    : Math.floor((coverage.translated / coverage.total) * 1000) / 10
}

function historyView(change: MessageChange): HistoryView {
  return {
    at: Number.isFinite(change.updatedAt)
      ? change.updatedAt
      : null,
    revision: change.revision,
    author: change.author,
  }
}

/** Locales with an outdated translation, per key. */
function outdatedByKey(coverage: readonly LocaleCoverage[]): Map<KeyString, LocaleCode[]> {
  const out = new Map<KeyString, LocaleCode[]>()
  for (const c of coverage) {
    for (const key of c.outdated) {
      out.set(key, [
        ...out.get(key) ?? [],
        c.locale,
      ])
    }
  }
  return out
}

const recentRevisions = 8
const keysPerRevision = 20

/** The latest revisions, each with the keys it changed and the locales of a key merged into one entry. */
function recentChangeGroups(project: UiProject['project']): ProjectSummary['changes'] {
  const groups = new Map<string, { updatedAt: number, view: HistoryView, keys: Map<KeyString, LocaleCode[]> }>()
  for (const key of project.keys()) {
    for (const locale of project.locales) {
      const change = project.history(key, locale)
      if (!change)
        continue
      const id = change.revision ?? 'local'
      const group = groups.get(id) ?? {
        updatedAt: change.updatedAt,
        view: historyView(change),
        keys: new Map(),
      }
      group.keys.set(key, [
        ...group.keys.get(key) ?? [],
        locale,
      ])
      groups.set(id, group)
    }
  }
  return [
    ...groups.values(),
  ]
    .sort((a, b) => b.updatedAt === a.updatedAt
      ? 0
      : b.updatedAt > a.updatedAt
        ? 1
        : -1)
    .slice(0, recentRevisions)
    .map(({ view, keys }) => ({
      ...view,
      total: keys.size,
      keys: [...keys].sort(([a], [b]) => a.localeCompare(b)).slice(0, keysPerRevision).map(([key, locales]) => ({ key, locales })),
    }))
}

export function summarize({ name, project }: UiProject): ProjectSummary {
  const analysis = project.analyze()
  const byCode = new Map<string, ProjectSummary['diagnostics']['byCode'][number]>()
  for (const d of analysis.diagnostics) {
    const entry = byCode.get(d.code)
    byCode.set(d.code, { code: d.code, severity: d.severity, count: (entry?.count ?? 0) + 1 })
  }
  const count = (severities: readonly string[]): number => analysis.diagnostics.filter(d => severities.includes(d.severity)).length
  return {
    name,
    sourceLocale: project.sourceLocale,
    namespaced: project.namespaced,
    locales: analysis.coverage.map((c) => {
      const info = project.localeInfo(c.locale)
      const outdated = new Set(c.outdated)
      const fresh = (keys: readonly KeyString[]): number => keys.filter(key => !outdated.has(key)).length
      return {
        code: c.locale,
        displayName: info.displayName,
        flag: info.flag,
        total: c.total,
        translated: c.translated,
        missing: c.missing.length,
        empty: c.empty.length,
        outdated: c.outdated.length,
        needsReview: fresh(c.needsReview),
        reviewed: fresh(c.reviewed),
        percent: percent(c),
      }
    }),
    resources: project.resources.length,
    keys: project.keys().length,
    usages: project.usages().length,
    diagnostics: {
      errors: count(['error']),
      warnings: count(['warning']),
      infos: count(['info', 'hint']),
      byCode: [
        ...byCode.values(),
      ].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    },
    presets: project.explain().presets.filter(p => p.reason === 'listed' || p.reason === 'detected').map(p => p.name),
    changes: recentChangeGroups(project),
    reviews: project.reviewFile === undefined
      ? undefined
      : project.reviews({ open: true }).length,
  }
}

export function keyTable({ name, project }: UiProject): KeyTable {
  const analysis = project.analyze()
  const unused = new Set(analysis.unused)
  const diagnostics = new Map<KeyString, number>()
  for (const d of analysis.diagnostics) {
    if (d.key !== undefined)
      diagnostics.set(d.key, (diagnostics.get(d.key) ?? 0) + 1)
  }
  const missing = new Map<KeyString, string[]>()
  for (const c of analysis.coverage) {
    for (const key of [
      ...c.missing,
      ...c.empty,
    ]) {
      const list = missing.get(key) ?? []
      missing.set(key, list)
      list.push(c.locale)
    }
  }
  const outdated = outdatedByKey(analysis.coverage)
  const reviews = new Map<KeyString, Record<LocaleCode, ReviewState>>()
  for (const thread of project.reviews({ open: true })) {
    if (thread.state) {
      reviews.set(thread.key, {
        ...reviews.get(thread.key),
        [thread.locale]: thread.state,
      })
    }
  }
  const now = Date.now()
  return {
    project: name,
    sourceLocale: project.sourceLocale,
    locales: project.locales,
    rows: project.keys().map((key) => {
      const info = project.get(key)
      // A plain loop: no arrays per key, and no `Math.max(...spread)` on large projects.
      let changedAt: number | undefined
      for (const locale of project.locales) {
        const at = project.history(key, locale)?.updatedAt
        if (at !== undefined)
          changedAt = Math.max(changedAt ?? -Infinity, Math.min(at, now))
      }
      const states: Record<LocaleCode, MessageState> = {}
      for (const m of info?.messages ?? []) {
        if (m.state)
          states[m.locale] = m.state
      }
      return {
        key,
        namespace: info?.namespace,
        label: info?.label,
        values: Object.fromEntries((info?.messages ?? []).map(m => [m.locale, m.value])),
        missing: missing.get(key) ?? [],
        unused: unused.has(key),
        diagnostics: diagnostics.get(key) ?? 0,
        outdated: outdated.get(key) ?? [],
        changedAt,
        reviews: reviews.get(key) ?? {},
        states,
      }
    }),
  }
}

const indexes = new WeakMap<UiProject, Map<string, { text: string, index: LineIndex }>>()

/** Line index of a file, rebuilt only when its text changed. */
function lineIndex(p: UiProject, path: string): LineIndex {
  const text = p.project.text(path) ?? ''
  const cache = indexes.get(p) ?? new Map<string, { text: string, index: LineIndex }>()
  indexes.set(p, cache)
  const cached = cache.get(path)
  if (cached?.text === text)
    return cached.index
  const index = createLineIndex(text)
  cache.set(path, { text, index })
  return index
}

function snippet(index: LineIndex, line: number, around = 2): Snippet {
  const first = Math.max(0, line - around)
  const last = Math.min(index.lineCount - 1, line + around)
  return {
    line: first + 1,
    lines: Array.from({ length: last - first + 1 }, (_, i) => index.line(first + i)),
  }
}

function usageView(p: UiProject, usage: Usage, possible = false): UsageView {
  const index = lineIndex(p, usage.path)
  const position = index.position(usage.range.start)
  return {
    key: usage.key,
    raw: usage.raw,
    path: usage.path,
    line: position.line + 1,
    column: position.character + 1,
    length: usage.range.end - usage.range.start,
    kind: usage.kind,
    dynamic: usage.dynamic,
    possible,
    snippet: snippet(index, position.line),
  }
}

export function usageViews(p: UiProject, matches: readonly UsageMatch[]): UsageView[] {
  return matches.map(m => usageView(p, m.usage, m.possible))
}

function wire(p: UiProject, diagnostics: readonly Diagnostic[]): WireDiagnostic[] {
  return diagnostics.map(d => toWireDiagnostic(p.name, d, path => p.project.text(path)))
}

export function keyDetail(p: UiProject, key: KeyString): KeyDetail | null {
  const { project } = p
  const info = project.get(project.parseKey(key))
  if (!info)
    return null
  const syntaxes = project.placeholderSyntaxes
  const outdated = new Set(outdatedByKey(project.analyze().coverage).get(info.key))
  const source = project.message(info.key, project.sourceLocale)?.value
  const sourceThen = (change: MessageChange | undefined): string | undefined => {
    const then = change && project.valueAt(info.key, project.sourceLocale, change.updatedAt)
    return then === undefined || then === source
      ? undefined
      : String(then)
  }
  return {
    project: p.name,
    key: info.key,
    namespace: info.namespace,
    label: info.label,
    messages: info.messages.map((m) => {
      const change = project.history(info.key, m.locale)
      const path = project.resources.find(r => r.id === m.resource)?.path ?? m.resource
      return {
        locale: m.locale,
        value: m.value,
        path,
        line: lineIndex(p, path).position(m.range?.key.start ?? 0).line + 1,
        placeholders: typeof m.value === 'string'
          ? syntaxes.flatMap(s => s.find(String(m.value))).map(ph => ({ text: ph.text, start: ph.range.start, end: ph.range.end })).sort((a, b) => a.start - b.start)
          : [],
        changed: change && historyView(change),
        outdated: outdated.has(m.locale),
        sourceThen: outdated.has(m.locale)
          ? sourceThen(change)
          : undefined,
        state: m.state,
        description: m.description,
      }
    }),
    missing: info.missing,
    usages: usageViews(p, info.usages),
    diagnostics: wire(p, info.diagnostics),
    reviews: info.reviews,
  }
}

export function analysisView(p: UiProject): AnalysisView {
  const analysis = p.project.analyze()
  return {
    project: p.name,
    diagnostics: wire(p, analysis.diagnostics),
    unused: analysis.unused,
    undefinedUsages: analysis.undefinedUsages.map(u => usageView(p, u)),
  }
}

export function explainView(p: UiProject): ExplainView {
  const { root: _root, ...rest } = p.project.explain()
  return rest
}

function planView(plan: Plan, problems: PlanView['problems']): PlanView {
  return {
    keys: plan.keys,
    warnings: plan.warnings,
    decisions: plan.decisions,
    changes: plan.changes.map(c => ({ type: c.type, path: c.path })),
    problems,
  }
}

export function previewOps(p: UiProject, ops: readonly EditOp[]): PlanView {
  return planView(p.project.plan(ops), placeholderProblems(p.project, ops))
}

/** Plans and applies ops; placeholder problems block the write unless `force`. */
export async function applyOps(p: UiProject, input: readonly EditOp[], options: { readonly answers?: Answers | undefined, readonly force?: boolean | undefined } = {}): Promise<ApplyView> {
  const author = input.some(op => op.type === 'review' && !op.author)
    ? await p.project.reviewAuthor()
    : undefined
  const ops = author
    ? input.map(op => op.type === 'review' && !op.author
        ? { ...op, author }
        : op)
    : input
  const plan = p.project.plan(ops)
  const problems = placeholderProblems(p.project, ops)
  if (problems.length > 0 && !options.force) {
    return {
      ...planView(plan, problems),
      applied: false,
      revision: p.project.revision,
    }
  }
  const answers: Record<string, string> = Object.fromEntries(plan.decisions.map(d => [d.id, options.answers?.[d.id] ?? d.default]))
  const result = await p.project.apply(plan, { answers })
  return {
    ...planView(plan, problems),
    applied: true,
    revision: result.revision,
  }
}

/** Plans the bulk delete of unused keys; writes only with `confirm`. */
export async function unusedDeletionView(p: UiProject, query: UnusedDeletionQuery): Promise<UnusedDeletionView> {
  const deletion = p.project.planUnused({ glob: query.glob, namespace: query.namespace })
  const view = {
    ...planView(deletion.plan, []),
    deleted: deletion.keys,
    kept: deletion.kept.map(k => ({
      key: k.key,
      usages: k.usages.map(u => usageView(p, u, true)),
    })),
  }
  if (!query.confirm)
    return { ...view, applied: false, revision: p.project.revision }
  const answers: Record<string, string> = Object.fromEntries(deletion.plan.decisions.map(d => [d.id, query.answers?.[d.id] ?? d.default]))
  const result = await p.project.apply(deletion.plan, { answers })
  return { ...view, applied: true, revision: result.revision }
}
