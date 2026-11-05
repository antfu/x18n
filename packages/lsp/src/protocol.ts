/**
 * The `x18n/*` custom protocol. Shapes are versioned with the JSON contract (`contractVersion` in `@x18n/core`).
 * Positions and ranges use LSP conventions (zero-based lines, UTF-16 characters).
 */

export interface Position {
  readonly line: number
  readonly character: number
}

export interface Range {
  readonly start: Position
  readonly end: Position
}

export interface Location {
  readonly uri: string
  readonly range: Range
}

export interface DocumentParams {
  readonly uri: string
}

export interface PositionParams extends DocumentParams {
  readonly position: Position
}

export interface ProjectInfo {
  readonly name: string
  readonly root: string
  readonly sourceLocale: string
  readonly locales: readonly { readonly code: string, readonly displayName: string | undefined, readonly flag: string | undefined }[]
  readonly displayLocale: string
  readonly keys: number
}

export interface KeyAtResult {
  readonly project: string
  readonly key: string
  readonly type: 'key' | 'subtree'
  readonly range: Range
}

export interface TreeParams {
  readonly project?: string | undefined
  /** Parent key; omitted for the roots. */
  readonly parent?: string | undefined
}

export interface TreeNode {
  readonly key: string
  readonly label: string
  readonly leaf: boolean
  readonly translated: number
  readonly total: number
  /** Display-locale value for leaves. */
  readonly value: string | undefined
}

export interface LocaleProgress {
  readonly locale: string
  readonly translated: number
  readonly total: number
  readonly missing: readonly string[]
  readonly empty: readonly string[]
}

export interface ProgressResult {
  readonly projects: readonly { readonly name: string, readonly locales: readonly LocaleProgress[] }[]
}

export interface FileKey {
  readonly key: string
  readonly range: Range
  readonly value: string | undefined
  readonly missing: boolean
  readonly dynamic: boolean
  /** Usages of the key in the project; prefix usages that may reach it count too. Omitted for dynamic entries. */
  readonly usages?: number | undefined
}

export interface FileKeysResult {
  readonly keys: readonly FileKey[]
  readonly hardStrings: readonly { readonly text: string, readonly range: Range }[]
}

export interface UsageReportResult {
  readonly unused: readonly { readonly project: string, readonly key: string, readonly location: Location | undefined }[]
  readonly missing: readonly { readonly project: string, readonly key: string, readonly locations: readonly Location[] }[]
}

export interface SearchParams {
  /** Text of a value in any locale, ignoring case. */
  readonly query: string
  /** Only values containing the query; by default a fuzzy match also counts. */
  readonly exact?: boolean | undefined
}

export interface SearchMatch {
  readonly project: string
  readonly key: string
  /** The best-matching locale, source first on ties. */
  readonly locale: string
  readonly value: string
  /** The entry holding the matched value. */
  readonly definition: Location | undefined
  readonly usages: readonly Location[]
}

export interface Decoration {
  readonly range: Range
  /** The whole call holding the key, when the scanner knows it. */
  readonly expression?: Range | undefined
  readonly key: string
  /** The display value: the display-locale message with static call params filled. */
  readonly value: string | undefined
  readonly state: 'ok' | 'missing' | 'dynamic'
}

export interface DecorationsResult {
  readonly locale: string
  readonly decorations: readonly Decoration[]
}

export interface SetDisplayLocaleParams {
  readonly locale: string | undefined
}

export interface OpenUiParams {
  readonly project?: string | undefined
}

export interface OpenUiResult {
  readonly url: string
  readonly token: string
}

export interface TranslatePromptParams {
  readonly project?: string | undefined
  readonly locale: string
  readonly keys?: readonly string[] | undefined
}

export interface ReviewsParams {
  readonly project?: string | undefined
  readonly key?: string | undefined
  readonly locale?: string | undefined
  /** Only unresolved comments, and only threads that have some. */
  readonly open?: boolean | undefined
}

export interface ReviewCommentInfo {
  readonly id: string
  readonly type: 'comment' | 'approve' | 'request-change' | 'suggestion'
  readonly author?: { readonly name?: string | undefined, readonly email?: string | undefined } | undefined
  /** ISO 8601. */
  readonly time: string
  readonly text?: string | undefined
  readonly suggestion?: string | undefined
  /** The value an approval approved. */
  readonly value?: string | undefined
  readonly resolved?: boolean | undefined
  /** An approval of a value the message no longer has. */
  readonly stale: boolean
}

export interface ReviewThreadInfo {
  readonly project: string
  readonly key: string
  readonly locale: string
  readonly state: 'changes-requested' | 'approved' | 'stale-approval' | 'suggested' | 'commented' | undefined
  readonly comments: readonly ReviewCommentInfo[]
  /** The key in the locale's resource; undefined while the locale lacks the message. */
  readonly location: Location | undefined
}

export interface ReviewsResult {
  readonly threads: readonly ReviewThreadInfo[]
}

export interface UnusedDeletionParams {
  /** Default: every project. */
  readonly project?: string | undefined
}

/** Dry run of the bulk delete of unused keys; `x18n.deleteUnused` applies it. */
export interface UnusedDeletionResult {
  readonly projects: readonly {
    readonly project: string
    /** Keys to delete, sorted, with one location per message. */
    readonly keys: readonly { readonly key: string, readonly locations: readonly Location[] }[]
    /** Unused keys left alone because fully dynamic usages in a scope may reach them, sorted. */
    readonly kept: readonly { readonly key: string, readonly usages: readonly Location[] }[]
    readonly warnings: readonly string[]
  }[]
}

export interface ChangedParams {
  readonly project: string
  readonly revision: number
  readonly keys: readonly string[]
}

export interface Methods {
  readonly projects: 'x18n/projects'
  readonly keyAt: 'x18n/keyAt'
  readonly tree: 'x18n/tree'
  readonly progress: 'x18n/progress'
  readonly fileKeys: 'x18n/fileKeys'
  readonly usageReport: 'x18n/usageReport'
  readonly unusedDeletion: 'x18n/unusedDeletion'
  readonly search: 'x18n/search'
  readonly decorations: 'x18n/decorations'
  readonly setDisplayLocale: 'x18n/setDisplayLocale'
  readonly openUi: 'x18n/openUi'
  readonly translatePrompt: 'x18n/translatePrompt'
  readonly reviews: 'x18n/reviews'
  readonly explain: 'x18n/explain'
  readonly changed: 'x18n/changed'
}

export const methods: Methods = {
  projects: 'x18n/projects',
  keyAt: 'x18n/keyAt',
  tree: 'x18n/tree',
  progress: 'x18n/progress',
  fileKeys: 'x18n/fileKeys',
  usageReport: 'x18n/usageReport',
  unusedDeletion: 'x18n/unusedDeletion',
  search: 'x18n/search',
  decorations: 'x18n/decorations',
  setDisplayLocale: 'x18n/setDisplayLocale',
  openUi: 'x18n/openUi',
  translatePrompt: 'x18n/translatePrompt',
  reviews: 'x18n/reviews',
  explain: 'x18n/explain',
  changed: 'x18n/changed',
}

/** Commands for `workspace/executeCommand`. */
export interface Commands {
  readonly set: 'x18n.set'
  readonly delete: 'x18n.delete'
  /** `{ project? }`: deletes the keys of `x18n/unusedDeletion` through `workspace/applyEdit`. */
  readonly deleteUnused: 'x18n.deleteUnused'
  readonly renamePrefix: 'x18n.renamePrefix'
  readonly extract: 'x18n.extract'
  /** `{ uri: <folder> }` -> `{ files: { path, content }[], notes, removable }`; nothing is written. */
  readonly migrateI18nAlly: 'x18n.migrateI18nAlly'
  /** `{ project?, key, locale, review, text?, suggestion? }`: adds a review comment, written to disk at once. */
  readonly review: 'x18n.review'
  /** `{ project?, id }` */
  readonly resolveReview: 'x18n.resolveReview'
  /** `{ project?, id }`: sets the suggested value and resolves the suggestion. */
  readonly applySuggestion: 'x18n.applySuggestion'
}

export const commands: Commands = {
  set: 'x18n.set',
  delete: 'x18n.delete',
  deleteUnused: 'x18n.deleteUnused',
  renamePrefix: 'x18n.renamePrefix',
  extract: 'x18n.extract',
  migrateI18nAlly: 'x18n.migrateI18nAlly',
  review: 'x18n.review',
  resolveReview: 'x18n.resolveReview',
  applySuggestion: 'x18n.applySuggestion',
}
