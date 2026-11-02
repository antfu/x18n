import type {
  DecorationsResult,
  DocumentParams,
  FileKeysResult,
  KeyAtResult,
  OpenUiParams,
  OpenUiResult,
  PositionParams,
  ProgressResult,
  ProjectInfo,
  ReviewsParams,
  ReviewsResult,
  SearchMatch,
  SearchParams,
  TranslatePromptParams,
  TreeNode,
  TreeParams,
  UnusedDeletionParams,
  UnusedDeletionResult,
  UsageReportResult,
} from '@x18n/lsp'

/** `x18n/*` requests: method -> [params, result]. */
export interface Requests {
  'x18n/projects': [undefined, ProjectInfo[]]
  'x18n/keyAt': [PositionParams, KeyAtResult | null]
  'x18n/tree': [TreeParams, TreeNode[]]
  'x18n/progress': [undefined, ProgressResult]
  'x18n/fileKeys': [DocumentParams, FileKeysResult]
  'x18n/usageReport': [undefined, UsageReportResult]
  'x18n/unusedDeletion': [UnusedDeletionParams, UnusedDeletionResult]
  'x18n/search': [SearchParams, SearchMatch[]]
  'x18n/decorations': [DocumentParams, DecorationsResult]
  'x18n/openUi': [OpenUiParams, OpenUiResult]
  'x18n/translatePrompt': [TranslatePromptParams, string]
  'x18n/reviews': [ReviewsParams, ReviewsResult]
  'x18n/explain': [undefined, string]
}

/** The slice of the language client the view models need; tests pass a fake. */
export interface X18nClient {
  request: <M extends keyof Requests>(method: M, params: Requests[M][0]) => Promise<Requests[M][1]>
}

/** Argument of `x18n.openKey` and the translate prompt commands, also sent by hover links. */
export interface KeyRef {
  readonly project?: string | undefined
  readonly key: string
}

export function isKeyRef(value: unknown): value is KeyRef {
  return typeof value === 'object' && value !== null && 'key' in value && typeof value.key === 'string'
    && (!('project' in value) || value.project === undefined || typeof value.project === 'string')
}

/** The project whose root holds `path` (the deepest one wins, as in the server). */
export function projectFor(projects: readonly ProjectInfo[], path: string): ProjectInfo | undefined {
  const inside = projects.filter(p => path === p.root || path.startsWith(`${p.root}/`) || path.startsWith(`${p.root}\\`))
  return inside.sort((a, b) => b.root.length - a.root.length)[0]
}
