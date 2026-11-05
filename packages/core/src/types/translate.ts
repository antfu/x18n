import type { CacheStore, Logger } from './host'
import type { KeyString, LocaleCode, LocaleInfo } from './model'
import type { Plan } from './project'

/** A secret as config refers to it: an environment variable (`{ env: 'DEEPL_API_KEY' }`), or the value itself (TS config only). */
export type SecretRef = string | { readonly env: string }

/** What a translator can handle. Core reads these to decide what to send it. */
export interface TranslatorFeatures {
  /**
   * How placeholders reach the translator.
   * - `'xml'`: each is replaced with `<x id="0"/>`, for services with tag handling.
   * - `'token'`: opaque tokens `⟦0⟧` that the service leaves alone.
   * - `'raw'`: the source as written, with the placeholder list beside it (LLMs).
   */
  readonly placeholders: 'xml' | 'token' | 'raw'
  /** Reads descriptions, usages, related values, examples and rules. False: core sends only the text. */
  readonly context: boolean
  /** Can use the problems and its previous output on a retry. False: a failed item goes to the next translator. */
  readonly feedback: boolean
  /** Can update an existing translation from the previous source and a word diff. False: stale items get no `previous`. */
  readonly update: boolean
  /** `'native'`: the service applies the glossary itself. `'prompt'`: entries go into the batch. `'none'`: no entries. */
  readonly glossary: 'native' | 'prompt' | 'none'
  /** Largest batch. Core splits batches under both limits. */
  readonly batch: { readonly maxItems: number, readonly maxChars?: number | undefined }
  /** Batches in flight at once. Default 4. */
  readonly concurrency?: number | undefined
  /** Calls cost money or quota; surfaces confirm before a paid run. */
  readonly paid: boolean
}

export interface LocalePair {
  readonly from: LocaleCode
  readonly to: LocaleCode
}

export interface TranslatorContext {
  /** Resolves a secret reference through the host. Undefined when it is not set. */
  readonly secret: (ref: SecretRef) => string | undefined
  readonly logger: Logger | undefined
  /** Storage across runs for the translator's own data (a service glossary id, a language list). */
  readonly cache: CacheStore | undefined
}

/** Turns a batch of source messages into target values, through a service or a model. */
export interface Translator {
  /** Unique, kebab-case: `'ai'`, `'deepl'`. */
  readonly id: string
  readonly features: TranslatorFeatures
  /** Whether the translator serves a locale pair. Without it, every pair. */
  readonly supports?: ((pair: LocalePair, ctx: TranslatorContext) => boolean | Promise<boolean>) | undefined
  /** Changes when options that change the output change (model, formality). Part of the cache key. */
  readonly fingerprint?: string | undefined
  readonly override?: boolean | undefined
  readonly translate: (batch: TranslateBatch, ctx: TranslatorContext) => Promise<TranslateBatchResult>
}

export interface ItemPlaceholder {
  /** As sent: `<x id="0"/>`, `⟦0⟧`, or the raw text (`{name}`). */
  readonly token: string
  /** As written in the source. */
  readonly raw: string
  /** Placeholder syntax id. */
  readonly syntax: string
}

export interface TranslateItem {
  /** Batch-local id (`m1`); the reply is matched by it. */
  readonly id: string
  readonly key: KeyString
  /** The source value, with placeholders shown as `features.placeholders` says. */
  readonly text: string
  readonly placeholders: readonly ItemPlaceholder[]
  readonly description?: string | undefined
  /** Code around usages of the key. */
  readonly context?: readonly { readonly path: string, readonly line: number, readonly snippet: string }[] | undefined
  /** Values in related locales, nearest first. */
  readonly related?: readonly { readonly locale: LocaleCode, readonly value: string }[] | undefined
  /** Update mode: the translation of an older source, and what changed in `[-removed-] {+added+}` form. */
  readonly previous?: { readonly source: string, readonly translation: string, readonly diff: string } | undefined
  /** On a retry: what the translator returned last time, and why it was rejected. */
  readonly retry?: { readonly output: string, readonly problems: readonly string[] } | undefined
}

/** The batch rendered for LLMs, so every LLM translator sends the same request. */
export interface TranslatorPrompt {
  readonly system: string
  /** The items and context as JSON. */
  readonly user: string
  /** Bumped when the prompt changes in a way that changes output. Recorded in provenance and the cache key. */
  readonly version: string
}

export interface TranslateBatch {
  readonly from: LocaleCode
  readonly to: LocaleCode
  readonly fromInfo: LocaleInfo
  readonly toInfo: LocaleInfo
  readonly items: readonly TranslateItem[]
  /** Glossary entries whose term occurs in this batch, for the target locale. Empty when `features.glossary` is `'none'`. */
  readonly glossary: readonly { readonly term: string, readonly translation: string | undefined, readonly doNotTranslate: boolean, readonly note: string | undefined }[]
  /** From config `translate.rules`, presets and `translatePrompt` hooks. Empty when `features.context` is false. */
  readonly rules: readonly string[]
  /** Existing target messages as a style reference. Empty when `features.context` is false. */
  readonly examples: readonly { readonly source: string, readonly target: string }[]
  /** What is being translated, from config `translate.subject`. */
  readonly subject: string | undefined
  readonly prompt: TranslatorPrompt
  readonly signal: AbortSignal
}

export interface TranslatedItem {
  readonly id: string
  readonly text: string
  /** The translator declines the item (unsupported, filtered); core tries the next translator. */
  readonly declined?: string | undefined
}

export interface TranslationUsage {
  readonly requests: number
  readonly characters?: number | undefined
  readonly inputTokens?: number | undefined
  readonly outputTokens?: number | undefined
  /** As reported by the service, or computed from pricing. */
  readonly costUsd?: number | undefined
}

export interface TranslateBatchResult {
  readonly items: readonly TranslatedItem[]
  readonly usage?: TranslationUsage | undefined
  /** The model or engine version that answered, for provenance. */
  readonly model?: string | undefined
}

/** What `planTranslation` selects: the translate prompt's selection, for one or more target locales. */
export interface TranslationOptions {
  readonly to: readonly LocaleCode[] | 'all'
  /** Key glob, or a list of keys (translated again even when they have a value). */
  readonly keys?: string | readonly KeyString[] | undefined
  readonly namespace?: string | undefined
  /** Add stale translations (load history first). */
  readonly stale?: boolean | undefined
  /** Add values that checks report in the target locale, all checks (`true`) or these ids. */
  readonly check?: boolean | readonly string[] | undefined
  /** Translator ids, or translator objects a surface brings. Default: the configured chain. */
  readonly translators?: readonly (string | Translator)[] | undefined
  /** `'value'` (default) writes values; `'suggestion'` leaves review suggestions; `'none'` plans nothing. Existing values get suggestions unless `overwrite`. */
  readonly write?: TranslationWrite | undefined
  readonly overwrite?: boolean | undefined
  /** Items per run, over all locales. Default: config `translate.limit`. */
  readonly limit?: number | undefined
  readonly budget?: TranslationBudget | undefined
  readonly retries?: number | undefined
  /** Reuse earlier answers and rejections from the host cache. Default: config `translate.cache`. */
  readonly cache?: boolean | undefined
  /** Translate items again that an earlier run rejected. */
  readonly retryRejected?: boolean | undefined
}

export type TranslationWrite = 'value' | 'suggestion' | 'none'

export interface TranslationBudget {
  readonly usd?: number | undefined
  readonly characters?: number | undefined
}

/**
 * Why a message was not translated: no translator serves the pair, its resource is read-only, the run's `limit` or `budget`
 * was reached, an earlier run rejected it (`cached-rejection`), the run was cancelled, or the translator left a reported value as it is (`kept`).
 */
export type TranslationSkipReason = 'unsupported-pair' | 'read-only' | 'limit' | 'budget' | 'cached-rejection' | 'cancelled' | 'kept'

export interface TranslationSkip {
  readonly key: KeyString
  readonly locale: LocaleCode
  readonly reason: TranslationSkipReason
}

export interface TranslationJobItem {
  readonly key: KeyString
  readonly locale: LocaleCode
  /** The first translator in the item's chain. */
  readonly translator: string
  /** `'update'`: a stale translation updated from a word diff; `'cached'`: answered from the cache, no call. */
  readonly kind: 'fresh' | 'update' | 'cached'
}

export interface TranslatorEstimate {
  readonly translator: string
  readonly items: number
  readonly characters: number
  readonly batches: number
  readonly paid: boolean
}

/** A planned translation run: what it would translate and with what, before any call. */
export interface TranslationJob {
  readonly id: string
  /** The project revision the job was planned at; `translate` refuses a job from an older revision. */
  readonly revision: number
  readonly items: readonly TranslationJobItem[]
  readonly skipped: readonly TranslationSkip[]
  readonly estimate: readonly TranslatorEstimate[]
}

export interface TranslationIssue {
  /** Check id, such as `placeholder-mismatch`, or `response` and `translator-error`. */
  readonly code: string
  readonly severity: 'error' | 'warning' | 'info'
  readonly message: string
}

export interface TranslationCandidate {
  readonly key: KeyString
  readonly locale: LocaleCode
  readonly value: string
  readonly translator: string
  readonly derived: 'fresh' | 'update'
  /** Warnings of the message checks; a candidate has no errors. */
  readonly issues: readonly TranslationIssue[]
  /** How the plan writes it. */
  readonly write: TranslationWrite
  readonly cached: boolean
}

export interface TranslationRejection {
  readonly key: KeyString
  readonly locale: LocaleCode
  /** Translators tried, in order. */
  readonly translators: readonly string[]
  readonly output?: string | undefined
  readonly issues: readonly TranslationIssue[]
}

export type TranslationEvent
  = | { readonly type: 'batch-start', readonly translator: string, readonly locale: LocaleCode, readonly items: number }
    | { readonly type: 'candidate', readonly candidate: TranslationCandidate }
    | { readonly type: 'rejected', readonly rejection: TranslationRejection }
    | { readonly type: 'usage', readonly translator: string, readonly usage: TranslationUsage }

export interface TranslationResult {
  readonly candidates: readonly TranslationCandidate[]
  readonly rejected: readonly TranslationRejection[]
  readonly skipped: readonly TranslationSkip[]
  /** Per translator id. */
  readonly usage: { readonly [translator: string]: TranslationUsage }
  readonly cancelled: boolean
  /** The writes, by `write`. Apply with `project.apply`; it fails like any plan when files changed since. */
  readonly plan: Plan
}

export interface TranslationRun extends AsyncIterable<TranslationEvent> {
  readonly result: Promise<TranslationResult>
}

/** Machine-translation provenance as a `set` op carries it. */
export interface MachineSource {
  readonly translator: string
  readonly model?: string | undefined
  /** `TranslatorPrompt.version` of the request. */
  readonly prompt?: string | undefined
}
