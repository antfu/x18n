import type { FileKeysResult, Location, ProgressResult, ProjectInfo, Range, ReviewCommentInfo, ReviewsResult, ReviewThreadInfo, TreeNode, UsageReportResult } from '@x18n/lsp'
import type { KeyRef, X18nClient } from './client'
import { l10n } from './l10n'

/** What a tree item shows and does, independent of the `vscode` API. */
export interface Item {
  readonly label: string
  readonly description?: string | undefined
  readonly tooltip?: string | undefined
  /** Codicon id. */
  readonly icon?: string | undefined
  /** Theme color id for the icon. */
  readonly color?: string | undefined
  /** Locale whose flag replaces the icon when `x18n.showFlags` is on. */
  readonly locale?: { readonly code: string, readonly flag: string | undefined } | undefined
  /** `x18n.key` for leaves, `x18n.prefix` for parents; drives the context menu. */
  readonly context?: 'x18n.key' | 'x18n.prefix' | undefined
  readonly ref?: KeyRef | undefined
  /** Revealed on click. */
  readonly location?: Location | undefined
  /** Opens the key in the UI on click. */
  readonly openKey?: KeyRef | undefined
  /** Lazy children; collapsible when present. */
  readonly children?: (() => Promise<Item[]>) | undefined
}

function percent(translated: number, total: number): string {
  return total === 0
    ? '100%'
    : `${Math.floor(translated / total * 100)}%`
}

function keyItem(node: TreeNode, project: string | undefined, client: X18nClient): Item {
  const ref = { project, key: node.key }
  if (node.leaf) {
    return {
      label: node.label,
      description: node.value ?? l10n.t('(missing)'),
      tooltip: node.key,
      icon: 'symbol-string',
      context: 'x18n.key',
      ref,
      openKey: ref,
    }
  }
  return {
    label: node.label,
    description: `${node.translated}/${node.total}`,
    tooltip: l10n.t('{0} · {1} translated', node.key, percent(node.translated, node.total)),
    icon: 'symbol-namespace',
    context: 'x18n.prefix',
    ref,
    children: () => keyTree(client, project, node.key),
  }
}

/** Keys view, lazy by parent; one root per project when there are several. */
export async function keyTree(client: X18nClient, project?: string, parent?: string): Promise<Item[]> {
  if (project === undefined && parent === undefined) {
    const projects = await client.request('x18n/projects', undefined)
    if (projects.length > 1) {
      return projects.map(p => ({
        label: p.name,
        description: l10n.t('Keys: {0}', p.keys),
        icon: 'project',
        children: () => keyTree(client, p.name),
      }))
    }
  }
  const nodes = await client.request('x18n/tree', { project, parent })
  return nodes.map(node => keyItem(node, project, client))
}

function lineOf(range: Range): string {
  return `L${range.start.line + 1}`
}

/** Current File view, for the document at `uri` in `project`. */
export function fileItems(uri: string, project: string | undefined, result: FileKeysResult): Item[] {
  const keys = result.keys.map((k): Item => ({
    label: k.key,
    description: `${k.dynamic
      ? l10n.t('(dynamic)')
      : k.missing
        ? l10n.t('(missing)')
        : k.value ?? ''} · ${lineOf(k.range)}`,
    icon: k.dynamic
      ? 'symbol-variable'
      : k.missing ? 'warning' : 'symbol-string',
    color: k.missing ? 'list.warningForeground' : undefined,
    context: k.dynamic ? undefined : 'x18n.key',
    ref: k.dynamic
      ? undefined
      : { project, key: k.key },
    location: { uri, range: k.range },
  }))
  const hard = result.hardStrings.map((h): Item => ({
    label: h.text,
    description: `${l10n.t('hard string')} · ${lineOf(h.range)}`,
    icon: 'quote',
    location: { uri, range: h.range },
  }))
  return [
    ...keys,
    ...hard,
  ]
}

function keyList(keys: readonly string[], project: string): Item[] {
  return keys.map(key => ({
    label: key,
    icon: 'symbol-string',
    context: 'x18n.key',
    ref: { project, key },
    openKey: { project, key },
  }))
}

/** Progress view: locales with coverage, expanding to missing and empty keys. `projects` gives the flags. */
export function progressItems(result: ProgressResult, projects: readonly ProjectInfo[]): Item[] {
  const locales = (project: ProgressResult['projects'][number]): Item[] => project.locales.map(l => ({
    label: l.locale,
    description: `${percent(l.translated, l.total)} · ${l.translated}/${l.total}`,
    icon: l.translated === l.total
      ? 'pass'
      : 'circle-large-outline',
    locale: { code: l.locale, flag: projects.find(p => p.name === project.name)?.locales.find(c => c.code === l.locale)?.flag },
    ...l.missing.length + l.empty.length > 0
      ? {
          children: async () => [
            ...l.missing.length
              ? [
                  {
                    label: l10n.t('Missing'),
                    description: String(l.missing.length),
                    icon: 'warning',
                    children: async () => keyList(l.missing, project.name),
                  },
                ]
              : [],
            ...l.empty.length
              ? [
                  {
                    label: l10n.t('Empty'),
                    description: String(l.empty.length),
                    icon: 'circle-slash',
                    children: async () => keyList(l.empty, project.name),
                  },
                ]
              : [],
          ],
        }
      : {},
  }))
  const [only, ...rest] = result.projects
  if (only && rest.length === 0)
    return locales(only)
  return result.projects.map(p => ({
    label: p.name,
    icon: 'project',
    children: async () => locales(p),
  }))
}

/** Usage Report view: unused keys and keys used but not defined. */
export function usageReportItems(result: UsageReportResult): Item[] {
  const unused = result.unused.map((u): Item => ({
    label: u.key,
    description: u.project,
    icon: 'symbol-string',
    context: 'x18n.key',
    ref: { project: u.project, key: u.key },
    location: u.location,
  }))
  const missing = result.missing.map((m): Item => ({
    label: m.key,
    description: l10n.t('Usages: {0}', m.locations.length),
    icon: 'warning',
    color: 'list.warningForeground',
    location: m.locations[0],
    ...m.locations.length > 1
      ? {
          children: async () => m.locations.map(location => ({
            label: lineOf(location.range),
            description: location.uri,
            location,
          })),
        }
      : {},
  }))
  return [
    {
      label: l10n.t('Unused'),
      description: String(unused.length),
      icon: 'circle-slash',
      children: async () => unused,
    },
    {
      label: l10n.t('Missing'),
      description: String(missing.length),
      icon: 'warning',
      children: async () => missing,
    },
  ]
}

interface ReviewStateView {
  readonly label: string
  readonly icon: string
  readonly color?: string
}

/** Label, icon and color of a review thread state. Labels are translated per call, never at module load. */
export function reviewState(state: NonNullable<ReviewThreadInfo['state']>): ReviewStateView {
  switch (state) {
    case 'changes-requested':
      return {
        label: l10n.t('changes requested'),
        icon: 'request-changes',
        color: 'list.warningForeground',
      }
    case 'approved':
      return {
        label: l10n.t('approved'),
        icon: 'check',
      }
    case 'stale-approval':
      return {
        label: l10n.t('approved, changed since'),
        icon: 'history',
        color: 'list.warningForeground',
      }
    case 'suggested':
      return {
        label: l10n.t('suggestion'),
        icon: 'lightbulb',
      }
    case 'commented':
      return {
        label: l10n.t('comments'),
        icon: 'comment',
      }
  }
}

/** What a review of one type says, as a comment label. */
export function reviewTypeLabel(type: ReviewCommentInfo['type']): string {
  switch (type) {
    case 'comment':
      return l10n.t('comment')
    case 'approve':
      return l10n.t('approved')
    case 'request-change':
      return l10n.t('requested a change')
    case 'suggestion':
      return l10n.t('suggestion')
  }
}

/** Reviews view: one item per thread with open comments, expanding to the comments. */
export function reviewItems(result: ReviewsResult): Item[] {
  return result.threads.flatMap((thread): Item[] => {
    if (!thread.state)
      return []
    const state = reviewState(thread.state)
    const ref = { project: thread.project, key: thread.key }
    return [
      {
        label: thread.key,
        description: `${thread.locale} · ${state.label}`,
        icon: state.icon,
        color: state.color,
        context: 'x18n.key',
        ref,
        location: thread.location,
        openKey: ref,
        children: async () => thread.comments.map(c => ({
          label: c.text ?? (c.suggestion === undefined
            ? reviewTypeLabel(c.type)
            : l10n.t('suggests "{0}"', c.suggestion)),
          description: `${reviewTypeLabel(c.type)} · ${c.author?.name ?? c.author?.email ?? l10n.t('unknown')} · ${c.time.slice(0, 10)}`,
          tooltip: c.suggestion === undefined
            ? undefined
            : l10n.t('Suggested value: {0}', c.suggestion),
          icon: c.type === 'suggestion'
            ? 'lightbulb'
            : c.type === 'approve'
              ? 'check'
              : c.type === 'request-change'
                ? 'request-changes'
                : 'comment',
          location: thread.location,
        })),
      },
    ]
  })
}
