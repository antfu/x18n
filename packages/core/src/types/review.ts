import type { KeyString, LocaleCode } from './model'
import type { Plan } from './project'

export type ReviewType = 'comment' | 'approve' | 'request-change' | 'suggestion'

export interface ReviewAuthor {
  readonly name?: string | undefined
  readonly email?: string | undefined
}

/** One entry of a review thread, as stored. */
export interface ReviewComment {
  /** Short random id, unique within the review file. */
  readonly id: string
  readonly type: ReviewType
  readonly author?: ReviewAuthor | undefined
  /** ISO 8601 time. */
  readonly time: string
  readonly text?: string | undefined
  /** The proposed value of a `suggestion`. */
  readonly suggestion?: string | undefined
  /** The value an `approve` approved; the approval is stale once the message has another value. */
  readonly value?: string | undefined
  readonly resolved?: boolean | undefined
}

/** Everything a review store holds. */
export interface ReviewData {
  /** Comments per key and locale, oldest first. */
  readonly threads: { readonly [key: KeyString]: { readonly [locale: LocaleCode]: readonly ReviewComment[] } }
  /** Hash of the source value when x18n last wrote each target message. */
  readonly sources: { readonly [key: KeyString]: { readonly [locale: LocaleCode]: string } }
  /** Values a translator wrote, per key and locale. Stores that predate machine translation leave it out. */
  readonly machine?: { readonly [key: KeyString]: { readonly [locale: LocaleCode]: MachineRecord } } | undefined
}

/** Where a machine-translated value came from. The message is machine-translated while its value has `value` as hash and no open approval approved it. */
export interface MachineRecord {
  readonly translator: string
  readonly model?: string | undefined
  /** Prompt version of the request. */
  readonly prompt?: string | undefined
  /** ISO 8601 time of the write. */
  readonly time: string
  /** Hash of the written value. */
  readonly value: string
}

/** Reads and writes the review file (`review.file`). Core does the I/O and puts writes into edit plans. */
export interface ReviewStore {
  readonly id: string
  /** Throws on invalid content; core reports it as a coded error. */
  readonly parse: (text: string) => ReviewData
  readonly serialize: (data: ReviewData) => string
}

/** Where a thread stands: the last open approval or change request decides, then open suggestions, then open comments. */
export type ReviewState = 'changes-requested' | 'approved' | 'stale-approval' | 'suggested' | 'commented'

export interface ThreadComment extends ReviewComment {
  /** An approval of a value the message no longer has. */
  readonly stale: boolean
}

/** The comments on one message. */
export interface ReviewThread {
  readonly key: KeyString
  readonly locale: LocaleCode
  readonly comments: readonly ThreadComment[]
  /** Undefined when every comment is resolved. */
  readonly state: ReviewState | undefined
}

export interface ReviewFilter {
  readonly key?: KeyString | undefined
  readonly locale?: LocaleCode | undefined
  /** Only unresolved comments, and only threads that have some. */
  readonly open?: boolean | undefined
}

/** Which messages `planApprovals` approves. It MUST narrow the selection: a glob, a namespace, a filter or `values`. */
export interface ApprovalQuery {
  /** Default: every locale but the source. */
  readonly locales?: readonly LocaleCode[] | 'all' | undefined
  /** Key glob: `*` inside a segment, `**` across segments. `**` alone selects every key. */
  readonly glob?: string | undefined
  readonly namespace?: string | undefined
  /** Only machine-translated messages; with a translator id, only its output. */
  readonly machine?: boolean | string | undefined
  /** Only messages whose resource records this translation state. */
  readonly state?: 'needs-review' | 'translated' | undefined
  /** Only messages whose review thread has this state. */
  readonly thread?: 'suggested' | 'commented' | 'stale-approval' | undefined
  /** The exact values the reviewer saw; a message whose value differs is skipped with `value-changed`. */
  readonly values?: readonly { readonly key: KeyString, readonly locale: LocaleCode, readonly value: string }[] | undefined
  /** Stale translations: skip them (default), approve them, or approve them and mark them fresh. */
  readonly stale?: 'skip' | 'approve' | 'mark-fresh' | undefined
  /** Approve messages whose thread has an open change request. Default false. */
  readonly overrideChangeRequests?: boolean | undefined
  /** Text of every approval. */
  readonly text?: string | undefined
  readonly author?: ReviewAuthor | undefined
  readonly limit?: number | undefined
}

export type ApprovalSkipReason = 'empty' | 'already-approved' | 'value-changed' | 'failing-check' | 'changes-requested' | 'stale' | 'read-only' | 'limit'

export interface ApprovalSkip {
  readonly key: KeyString
  readonly locale: LocaleCode
  readonly reason: ApprovalSkipReason
}

/** Many approvals as one plan: review it (dry run), then pass `plan` to `apply`. */
export interface ApprovalPlan {
  readonly plan: Plan
  /** Sorted by key, then locale. */
  readonly approved: readonly { readonly key: KeyString, readonly locale: LocaleCode, readonly value: string, readonly machine: string | undefined }[]
  readonly skipped: readonly ApprovalSkip[]
}
