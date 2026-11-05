import type { KeySeparator } from './config'
import type { ReviewAuthor, ReviewType } from './review'

// Domain names from the glossary. Branding them would force a cast at every boundary.
/* eslint-disable slop/no-trivial-type-aliases */
/** A locale code exactly as written in paths and files: `en`, `zh_CN`, `pt-BR`. Never normalized. */
export type LocaleCode = string

/** Canonical key string: `ns:a.b.c`, or `a.b.c` without namespace. */
export type KeyString = string

/** Resource id: the resource path, plus `#<block index>` for embedded resources. */
export type ResourceId = string
/* eslint-enable slop/no-trivial-type-aliases */

export type MessageLeaf = string | number | boolean | null

export interface MessageTree {
  readonly [segment: string]: MessageLeaf | MessageTree
}

/** UTF-16 offsets, the same as JS strings. */
export interface TextRange {
  readonly start: number
  readonly end: number
}

export interface TextEdit {
  readonly range: TextRange
  readonly text: string
}

/** Ranges of a key and its value (or object) in the resource text. */
export interface NodeRange {
  readonly key: TextRange
  readonly value: TextRange
}

export interface KeyId {
  readonly namespace: string | undefined
  readonly path: readonly string[]
}

/** Display data from a lenient parse of a code. Never changes the code itself. */
export interface LocaleInfo {
  readonly code: LocaleCode
  readonly language: string | undefined
  readonly region: string | undefined
  readonly displayName: string | undefined
  readonly flag: string | undefined
  /** The plural categories a message may have. */
  readonly pluralCategories: readonly Intl.LDMLPluralRule[]
  /** Categories of ordinal numbers (1st, 2nd), which differ from the cardinal ones. */
  readonly ordinalCategories: readonly Intl.LDMLPluralRule[]
  /** The plural categories a message must have: those whole numbers select. French may leave out `many`, from 1,000,000 only. */
  readonly requiredPluralCategories: readonly Intl.LDMLPluralRule[]
  readonly requiredOrdinalCategories: readonly Intl.LDMLPluralRule[]
}

/** Embedded resource inside a file, for example a Vue `<i18n>` block. */
export interface ResourceBlock {
  readonly index: number
  /** Range of the block content in the file. */
  readonly range: TextRange
  readonly lang: string | undefined
}

export interface Resource {
  readonly id: ResourceId
  /** Posix path relative to the project root. */
  readonly path: string
  readonly locale: LocaleCode
  readonly namespace: string | undefined
  readonly format: string
  readonly block: ResourceBlock | undefined
  /** True for read-only formats and for resources loaded with `execute: true`. */
  readonly readonly: boolean
  /** Id of the locale finder that found the resource. */
  readonly finder: string
  /** Key separator of the resource when it differs from the config's `keySeparator` (from its resource spec). */
  readonly keySeparator?: KeySeparator | undefined
}

/** How far a translation got, as in XLIFF: a value can exist before anyone reviews it. */
export type MessageState = 'translated' | 'needs-review' | 'reviewed'

/** One stored value of one key in one locale. */
export interface Message {
  readonly key: KeyString
  readonly locale: LocaleCode
  readonly value: MessageLeaf
  readonly resource: ResourceId
  /** Property path as stored in the resource (`['a.b']` in a flat file, `['a', 'b']` nested). */
  readonly storedPath: readonly string[]
  /** Ranges in the resource file text (block offsets already added). */
  readonly range: NodeRange | undefined
  /** What the resource says about the message for translators, such as a note or a comment beside it. */
  readonly description?: string | undefined
  /** The translation state the resource records, such as XLIFF `state` or PO `fuzzy`. */
  readonly state?: MessageState | undefined
  /** A display label of the key from the resource, for keys that do not read well, such as hashes. */
  readonly label?: string | undefined
}

export type UsageKind = 'call' | 'selector' | 'accessor' | 'constant' | 'marker'

export interface Usage {
  /** Undefined when the key is fully dynamic. */
  readonly key: KeyString | undefined
  /** The key text as written in code. */
  readonly raw: string
  readonly path: string
  /** Range of the key text only (inside the quotes): the range rename rewrites. */
  readonly range: TextRange
  /** Range of the whole call that holds the key (`t('a', { n })`), when the scanner knows it. */
  readonly expression: TextRange | undefined
  /** Names of the params the call passes (`t('a', { n })` gives `['n']`); undefined when the scanner cannot tell, as with a spread or a variable. */
  readonly params?: readonly string[] | undefined
  /** Static string values of the params (`t('a', { name: 'Ada' })` gives `{ name: 'Ada' }`). */
  readonly paramValues?: Readonly<Record<string, string>> | undefined
  /** The default value written in code (`t('a', 'Default')`), when the scanner knows it. */
  readonly defaultValue?: string | undefined
  /** A description of the message written next to the key in code (`CallSpec.description`), when the scanner knows it. */
  readonly description?: string | undefined
  readonly scanner: string
  readonly kind: UsageKind
  /** `t(`pages.${id}.title`)` gives 'prefix' with key `pages`. */
  readonly dynamic: false | 'prefix' | 'unknown'
  readonly locale: LocaleCode | undefined
  /** Namespace that came from a scope or a factory, not from the raw text. */
  readonly scopeNamespace: string | undefined
  /** Key prefix that came from a scope or factory (`keyPrefix`), not from the raw text. */
  readonly scopePrefix: string | undefined
}

export type Severity = 'error' | 'warning' | 'info' | 'hint'

/** A `set` with `replace: false` is skipped, with a warning, when it would replace other keys or a message on its path. */
export type EditOp
  = | { readonly type: 'set', readonly key: KeyString, readonly locale: LocaleCode, readonly value: MessageLeaf, readonly replace?: boolean }
    | { readonly type: 'rename', readonly from: KeyString, readonly to: KeyString, readonly usages?: boolean }
    | { readonly type: 'rename-prefix', readonly from: KeyString, readonly to: KeyString, readonly usages?: boolean }
    | { readonly type: 'delete', readonly key: KeyString, readonly locales?: 'all' | readonly LocaleCode[] }
    | { readonly type: 'extract', readonly items: readonly ExtractItem[] }
    /** Re-write resources with the configured sort and indent. */
    | { readonly type: 'format', readonly paths?: readonly string[] }
    /** Adds a comment to the review thread of a message. `id` and `time` are filled in when planned. */
    | {
      readonly type: 'review'
      readonly key: KeyString
      readonly locale: LocaleCode
      readonly review: ReviewType
      readonly text?: string | undefined
      /** The proposed value, required for `suggestion`. */
      readonly suggestion?: string | undefined
      readonly author?: ReviewAuthor | undefined
      readonly id?: string | undefined
      readonly time?: string | undefined
    }
    | { readonly type: 'resolve-review', readonly id: string }
    /** Sets the value of a suggestion and resolves it. */
    | { readonly type: 'apply-suggestion', readonly id: string }
    /** Records that translations are up to date with the current source value. Default: every translated locale. */
    | { readonly type: 'mark-fresh', readonly key: KeyString, readonly locales?: readonly LocaleCode[] | undefined }

export interface ExtractItem {
  readonly path: string
  /** Range of the hard string in the source file, quotes included. */
  readonly range: TextRange
  readonly key: KeyString
  readonly value: string
  /** Replacement text for the range. */
  readonly replacement: string
  /** Lines to add once per file when missing, for example an import. */
  readonly imports?: readonly string[]
}

/**
 * How `x18n check --fix` may apply a fix. `safe` fixes only add, so `--fix` applies them; `unsafe` fixes can lose data, so
 * only `--fix=unsafe` applies them. A fix without a level is offered in the editor and never applied in bulk.
 */
export type FixLevel = 'safe' | 'unsafe'

export interface Fix {
  readonly title: string
  readonly ops: readonly EditOp[]
  readonly level?: FixLevel | undefined
}

export interface Location {
  readonly path: string
  readonly range: TextRange
}

export interface Diagnostic {
  /** Check id, for example 'missing-translation'. */
  readonly code: string
  readonly severity: Severity
  readonly message: string
  readonly key: KeyString | undefined
  readonly locale: LocaleCode | undefined
  readonly location: Location | undefined
  readonly fixes: readonly Fix[]
}

export interface Placeholder {
  readonly syntax: string
  /** Text as written, for example `{name}`. */
  readonly text: string
  /** Name used for comparison across locales, for example `name`. */
  readonly name: string
  readonly range: TextRange
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject
export interface JsonObject {
  readonly [key: string]: JsonValue
}
