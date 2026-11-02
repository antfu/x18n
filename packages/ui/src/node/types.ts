import type { ExtractCandidate } from '@x18n/builtins/extractors'
import type { Decision, EditOp, FileChange, KeyString, LocaleCode, MessageLeaf, PlaceholderProblem, Project, ProjectExplanation, ReviewState, ReviewThread, ReviewType, Severity, TextRange, UsageKind, WireDiagnostic } from '@x18n/core'
// Puts `devframe` into every program that sees these types, so the augmentation below resolves (the SPA only imports `devframe/client`).
import type {} from 'devframe'

/** A loaded project as the UI sees it. */
export interface UiProject {
  readonly name: string
  /** Absolute root. */
  readonly root: string
  readonly project: Project
}

/** A file position in a project, for "open in editor". */
export interface UiLocation {
  readonly project: UiProject
  /** Path relative to the project root. */
  readonly path: string
  /** 1-based. */
  readonly line: number
  /** 1-based. */
  readonly column: number
}

/** ---- Inputs ---- */
export interface ProjectQuery {
  /** Project name; may be omitted when the workspace has one project. */
  readonly project?: string | undefined
}

export interface KeyQuery extends ProjectQuery {
  readonly key: KeyString
}

export interface UsageQuery extends ProjectQuery {
  readonly key?: KeyString | undefined
  readonly path?: string | undefined
}

export interface PromptQuery extends ProjectQuery {
  readonly locale: LocaleCode
  readonly keys?: string | readonly KeyString[] | undefined
  readonly namespace?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  /** Also translate stale translations. */
  readonly stale?: boolean | undefined
  /** Also translate values that checks report in the locale: every check, or these check ids. */
  readonly check?: boolean | readonly string[] | undefined
}

/** Edit ops the UI and agents send; extraction has its own functions. */
export type UiEditOp = Exclude<EditOp, { readonly type: 'extract' | 'format' }>

export interface PlanQuery extends ProjectQuery {
  readonly ops: readonly UiEditOp[]
}

export interface ApplyQuery extends PlanQuery {
  /** Decision id to option id; unanswered decisions take their default. */
  readonly answers?: Readonly<Record<string, string>> | undefined
  /** Write values whose placeholders differ from the source value. */
  readonly force?: boolean | undefined
}

export interface ReviewQuery extends ProjectQuery {
  readonly key?: KeyString | undefined
  readonly locale?: LocaleCode | undefined
  /** Only unresolved comments. */
  readonly open?: boolean | undefined
}

export interface ExtractQuery extends ProjectQuery {
  readonly files?: readonly string[] | undefined
}

export type ExtractPlanItem = Pick<ExtractCandidate, 'path' | 'range' | 'original' | 'key' | 'value' | 'replacement' | 'imports'>

export interface ExtractApplyQuery extends ProjectQuery {
  readonly items: readonly ExtractPlanItem[]
}

export interface OpenQuery extends ProjectQuery {
  readonly path: string
  readonly line: number
  readonly column: number
}

interface PageQuery {
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export interface AgentKeysQuery extends ProjectQuery, PageQuery {
  readonly glob?: string | undefined
  readonly missing?: LocaleCode | undefined
  readonly unused?: boolean | undefined
  readonly namespace?: string | undefined
  readonly values?: boolean | undefined
}

export interface AgentSearchQuery extends ProjectQuery, PageQuery {
  readonly query: string
  readonly exact?: boolean | undefined
}

export interface AgentUsagesQuery extends UsageQuery, PageQuery {}

export interface AgentCheckQuery extends ProjectQuery, PageQuery {
  readonly only?: readonly string[] | undefined
  readonly locale?: readonly LocaleCode[] | undefined
}

export interface AgentSetQuery extends ProjectQuery {
  readonly messages: Readonly<Record<LocaleCode, Readonly<Record<string, MessageLeaf>>>>
  readonly force?: boolean | undefined
}

interface Confirmable {
  readonly confirm?: boolean | undefined
  readonly answers?: Readonly<Record<string, string>> | undefined
}

export interface AgentRenameQuery extends ProjectQuery, Confirmable {
  readonly from: KeyString
  readonly to: KeyString
  readonly usages?: boolean | undefined
}

export interface AgentReviewQuery extends ProjectQuery {
  readonly key: KeyString
  readonly locale: LocaleCode
  readonly review: ReviewType
  readonly text?: string | undefined
  readonly suggestion?: string | undefined
}

export interface AgentDeleteQuery extends ProjectQuery, Confirmable {
  readonly key: KeyString
  readonly locales?: readonly LocaleCode[] | undefined
}

/** ---- Outputs ---- */
/** When a message last changed, from the history providers (git). */
export interface HistoryView {
  /** Milliseconds since the epoch; null for a local change the provider does not know yet. */
  readonly at: number | null
  /** Commit sha or another provider revision. */
  readonly revision: string | undefined
  readonly author: string | undefined
}

/** The messages one revision changed. */
export interface ChangeGroup extends HistoryView {
  /** The first keys by name, each with every locale the revision touched. */
  readonly keys: readonly { readonly key: KeyString, readonly locales: readonly LocaleCode[] }[]
  /** How many keys the revision changed in all. */
  readonly total: number
}

export interface LocaleSummary {
  readonly code: LocaleCode
  readonly displayName: string | undefined
  readonly flag: string | undefined
  readonly total: number
  readonly translated: number
  readonly missing: number
  readonly empty: number
  /** Translations older than their source message. */
  readonly outdated: number
  /** One decimal, rounded down. */
  readonly percent: number
}

export interface DiagnosticCounts {
  readonly errors: number
  readonly warnings: number
  /** Infos and hints. */
  readonly infos: number
  readonly byCode: readonly { readonly code: string, readonly severity: Severity, readonly count: number }[]
}

export interface ProjectSummary {
  readonly name: string
  readonly sourceLocale: LocaleCode
  readonly namespaced: boolean
  readonly locales: readonly LocaleSummary[]
  readonly resources: number
  readonly keys: number
  readonly usages: number
  readonly diagnostics: DiagnosticCounts
  /** Presets that are listed in the config or detected. */
  readonly presets: readonly string[]
  /** The latest revisions in history, local changes first. */
  readonly changes: readonly ChangeGroup[]
  /** Threads with open comments; undefined when reviews are off. */
  readonly reviews: number | undefined
}

export interface ProjectList {
  readonly projects: readonly ProjectSummary[]
  readonly openInEditor: boolean
}

export interface KeyRow {
  readonly key: KeyString
  readonly namespace: string | undefined
  /** Stored value per locale; locales without the key are absent. */
  readonly values: Readonly<Record<LocaleCode, MessageLeaf>>
  /** Locales where the key is missing or empty. */
  readonly missing: readonly LocaleCode[]
  readonly unused: boolean
  readonly diagnostics: number
  /** Locales whose translation is older than the source message. */
  readonly outdated: readonly LocaleCode[]
  /** The latest change in any locale (ms); local changes count as now. */
  readonly changedAt: number | undefined
  /** Review state per locale with open comments. */
  readonly reviews: Readonly<Record<LocaleCode, ReviewState>>
}

export interface KeyTable {
  readonly project: string
  readonly sourceLocale: LocaleCode
  readonly locales: readonly LocaleCode[]
  readonly rows: readonly KeyRow[]
}

/** Lines of code around a position. */
export interface Snippet {
  /** 1-based number of the first line. */
  readonly line: number
  readonly lines: readonly string[]
}

export interface UsageView {
  readonly key: KeyString | undefined
  readonly raw: string
  readonly path: string
  /** 1-based. */
  readonly line: number
  /** 1-based. */
  readonly column: number
  /** Characters of the key text at `column`, for highlighting. */
  readonly length: number
  readonly kind: UsageKind
  readonly dynamic: false | 'prefix' | 'unknown'
  /** True for prefix usages that may refer to the key. */
  readonly possible: boolean
  readonly snippet: Snippet
}

export interface MessageView {
  readonly locale: LocaleCode
  readonly value: MessageLeaf
  readonly path: string
  readonly line: number
  /** Placeholders in a string value, with offsets in the value. */
  readonly placeholders: readonly ({ readonly text: string } & TextRange)[]
  readonly changed: HistoryView | undefined
  /** Older than the source message. */
  readonly outdated: boolean
  /** For an outdated translation: the source value when it last changed, when known. */
  readonly sourceThen: string | undefined
}

export interface KeyDetail {
  readonly project: string
  readonly key: KeyString
  readonly namespace: string | undefined
  readonly messages: readonly MessageView[]
  readonly missing: readonly LocaleCode[]
  readonly usages: readonly UsageView[]
  readonly diagnostics: readonly WireDiagnostic[]
  /** Every thread, resolved comments included. */
  readonly reviews: readonly ReviewThread[]
}

export interface AnalysisView {
  readonly project: string
  readonly diagnostics: readonly WireDiagnostic[]
  readonly unused: readonly KeyString[]
  /** Usages whose key is not defined in the source locale. */
  readonly undefinedUsages: readonly UsageView[]
}

export type ExplainView = Omit<ProjectExplanation, 'root'>

export interface ExplainList {
  readonly projects: readonly ExplainView[]
}

export interface ChangeView {
  readonly type: FileChange['type']
  readonly path: string
}

export interface PlanView {
  readonly keys: readonly KeyString[]
  readonly warnings: readonly string[]
  readonly decisions: readonly Decision[]
  readonly changes: readonly ChangeView[]
  /** Set values whose placeholders differ from the source value. */
  readonly problems: readonly PlaceholderProblem[]
}

export interface ApplyView extends PlanView {
  /** False when placeholder problems blocked the write. */
  readonly applied: boolean
  readonly revision: number
}

/** Shared state `x18n:state`: bumps on every change in any project. Mutable: it is the draft type of `mutate`. */
export interface X18nState {
  revision: number
  changedKeys: KeyString[]
}

declare module 'devframe' {
  interface DevframeRpcServerFunctions {
    'x18n:project': () => ProjectList
    'x18n:keys': (query: ProjectQuery) => KeyTable
    'x18n:key': (query: KeyQuery) => KeyDetail | null
    'x18n:usages': (query: UsageQuery) => UsageView[]
    'x18n:analysis': (query: ProjectQuery) => AnalysisView
    'x18n:explain': () => ExplainList
    'x18n:reviews': (query: ReviewQuery) => ReviewThread[]
    'x18n:translate-prompt': (query: PromptQuery) => string
    'x18n:plan': (query: PlanQuery) => PlanView
    'x18n:apply': (query: ApplyQuery) => Promise<ApplyView>
    'x18n:extract-candidates': (query: ExtractQuery) => ExtractCandidate[]
    'x18n:extract-apply': (query: ExtractApplyQuery) => Promise<ApplyView>
    'x18n:open-in-editor': (query: OpenQuery) => Promise<void>
  }
  interface DevframeRpcSharedStates {
    'x18n:state': X18nState
  }
}
