import type { CallSpec, ConfigDraft, ExtractTemplate, KeySeparator, ResolvedConfig, SerializableConfig } from './config'
import type { Disposable, Host } from './host'
import type {
  Diagnostic,
  Fix,
  JsonObject,
  KeyString,
  LocaleCode,
  LocaleInfo,
  Location,
  Message,
  MessageLeaf,
  MessageTree,
  NodeRange,
  Placeholder,
  Resource,
  ResourceBlock,
  Severity,
  TextEdit,
  TextRange,
  Usage,
  UsageKind,
} from './model'
import type { ReviewFilter, ReviewStore, ReviewThread } from './review'

export interface ConfigContext {
  readonly host: Host
  /** The user config as written, before presets ran. */
  readonly user: SerializableConfig
}

export interface ManifestReader {
  readonly id: string
  /** File name relative to the project root, for example 'package.json'. */
  readonly file: string
  /** Dependency names listed in the manifest. */
  readonly read: (text: string) => readonly string[]
}

export interface DetectContext {
  readonly host: Host
  readonly dependencies: ReadonlySet<string>
  readonly hasDependency: (name: string) => boolean
  readonly hasAnyDependency: (names: readonly string[]) => boolean
  readonly fileExists: (pattern: string) => Promise<boolean>
}

export interface ResourceCandidate {
  readonly path: string
  readonly locale: LocaleCode
  readonly namespace: string | undefined
  /** Format id hint; otherwise picked by extension. */
  readonly format?: string | undefined
  readonly block?: ResourceBlock | undefined
  readonly readonly?: boolean | undefined
  /** Key separator of the resource, over the config's (from `ResourceSpec.keySeparator`). */
  readonly keySeparator?: KeySeparator | undefined
}

export interface FinderContext {
  readonly host: Host
  readonly config: ResolvedConfig
  /** Extensions of every registered format. */
  readonly extensions: readonly string[]
}

export interface LocaleFinder {
  readonly id: string
  readonly override?: boolean | undefined
  readonly find: (ctx: FinderContext) => Promise<readonly ResourceCandidate[]>
  /**
   * Where a new resource for (locale, namespace) should go. Used by edits that create files.
   * `model` is the existing resource the new one would otherwise mirror: the key's source file when it has one.
   */
  readonly resolveNew?: ((target: { readonly locale: LocaleCode, readonly namespace: string | undefined, readonly model: Resource | undefined }, ctx: FinderContext) => string | undefined) | undefined
}

export interface FormatContext {
  readonly path: string
  readonly locale: LocaleCode
  readonly namespace: string | undefined
  readonly indent: number | 'tab' | undefined
}

export interface ParseResult {
  readonly tree: MessageTree
  /** Ranges of keys and values (leaves and objects), keyed by `pathId(storedPath)`. */
  readonly ranges?: ReadonlyMap<string, NodeRange> | undefined
  /** What the file says about a message for translators (a note or comment next to it), keyed by `pathId(storedPath)`. */
  readonly descriptions?: ReadonlyMap<string, string> | undefined
}

export type MessageOp
  = | { readonly type: 'set', readonly path: readonly string[], readonly value: MessageLeaf }
    | { readonly type: 'delete', readonly path: readonly string[] }

/** A built-in format known by its extensions only: the module behind `load` is imported when a file of that format is read. */
export interface FormatEntry {
  /** File extensions without the dot. */
  readonly extensions: readonly string[]
  /** The module's default export creates a plugin that holds the format. */
  readonly load: PluginLoader
}

/** A format entry under its id, as plugins list it. */
export interface LazyFormat extends FormatEntry {
  readonly id: string
}

/** A built-in scanner known by its extensions only: the module behind `load` is imported when a file it scans is first scanned. */
export interface ScannerEntry {
  /** File extensions without dot. `*` matches every file. */
  readonly extensions: readonly string[]
  /** The module's default export creates a plugin that holds the scanner. */
  readonly load: PluginLoader
}

/** A scanner entry under its id, as plugins list it. */
export interface LazyScanner extends ScannerEntry {
  readonly id: string
}

export interface Format {
  readonly id: string
  /** File extensions without the dot. */
  readonly extensions: readonly string[]
  readonly parse: (text: string, ctx: FormatContext) => ParseResult
  /** Edits text in place. Preferred; keeps comments and layout. Ops run in order. */
  readonly edit?: ((text: string, ops: readonly MessageOp[], ctx: FormatContext) => readonly TextEdit[]) | undefined
  /** Full serialization. Used to create files, and when `edit` is missing. */
  readonly serialize?: ((tree: MessageTree, ctx: FormatContext) => string) | undefined
}

export interface SourceFile {
  readonly path: string
  readonly text: string
  /** Extension without the dot. */
  readonly extension: string
}

export interface ScanContext {
  readonly config: ResolvedConfig
  /** Call specs after `usage.ignoreCallees`. */
  readonly calls: readonly CallSpec[]
}

export interface UsageCandidate {
  readonly raw: string
  readonly range: TextRange
  /** Range of the whole call that holds the key, when the scanner knows it. */
  readonly expression?: TextRange | undefined
  /** Names of the params the call passes, when they are all static. */
  readonly params?: readonly string[] | undefined
  /** The default value the call writes in code. */
  readonly defaultValue?: string | undefined
  /** A description of the message written next to the key in code. */
  readonly description?: string | undefined
  readonly kind: UsageKind
  readonly dynamic: false | 'prefix' | 'unknown'
  readonly namespace?: string | undefined
  readonly keyPrefix?: string | undefined
  readonly locale?: LocaleCode | undefined
}

/** A region of code with a default namespace or key prefix. */
export interface Scope {
  readonly range: TextRange
  readonly namespace?: string | undefined
  readonly keyPrefix?: string | undefined
  /** The key prefix applies only to keys it defines; others resolve without it, as page messages that extend global ones. */
  readonly optionalPrefix?: boolean | undefined
  /** With `optionalPrefix`: more prefixes to try after `keyPrefix`, in order. */
  readonly otherPrefixes?: readonly string[] | undefined
  /** With `optionalPrefix`: a prefixed key counts in the fallback namespaces too. */
  readonly prefixInFallback?: boolean | undefined
}

export interface HardString {
  readonly text: string
  /** Range of the whole literal, quotes included: what a replacement rewrites. */
  readonly range: TextRange
  readonly kind: string
  /** Template arguments: `${name}` becomes `{name}` in the message, the expression is passed to the call. */
  readonly args?: readonly { readonly name: string, readonly expression: string }[] | undefined
  /** Attribute name for attribute kinds. */
  readonly attribute?: string | undefined
}

export interface ScanResult {
  readonly usages: readonly UsageCandidate[]
  readonly scopes?: readonly Scope[] | undefined
  /** Positions where completion of a key makes sense. */
  readonly keySlots?: readonly TextRange[] | undefined
  /** Hard strings found while walking the same AST, for extraction. */
  readonly hardStrings?: readonly HardString[] | undefined
}

export interface Scanner {
  readonly id: string
  /** File extensions without dot. `*` matches every file. */
  readonly extensions: readonly string[]
  readonly runtime?: 'any' | 'node' | undefined
  readonly scan: (file: SourceFile, ctx: ScanContext) => ScanResult | Promise<ScanResult>
}

export interface Extractor {
  readonly id: string
  /** Replacement templates per hard-string kind for this library. */
  readonly templates: readonly ExtractTemplate[]
}

export interface DiagnosticInput {
  readonly message: string
  readonly key?: KeyString | undefined
  readonly locale?: LocaleCode | undefined
  /** Defaults to the message range of `key` in `locale` (or the source locale). */
  readonly location?: Location | undefined
  readonly severity?: Severity | undefined
  readonly fixes?: readonly Fix[] | undefined
}

export interface LocaleCoverage {
  readonly locale: LocaleCode
  readonly total: number
  readonly translated: number
  readonly missing: readonly KeyString[]
  readonly empty: readonly KeyString[]
  /** Translated keys whose message last changed before the source message. */
  readonly outdated: readonly KeyString[]
}

/** When a message last changed, as a history provider knows it. */
export interface MessageChange {
  /** Milliseconds since the epoch. `Infinity` for a change not yet known to the provider. */
  readonly updatedAt: number
  /** A provider revision, such as a commit sha. */
  readonly revision?: string | undefined
  readonly author?: string | undefined
  /** The value the provider knows. A different current value is a local change. */
  readonly value?: MessageLeaf | undefined
}

export interface MessageHistory {
  readonly changes: ReadonlyMap<KeyString, ReadonlyMap<LocaleCode, MessageChange>>
  /** The value a message had at a time, for translate prompts of stale messages. */
  readonly valueAt?: ((key: KeyString, locale: LocaleCode, at: number) => MessageLeaf | undefined) | undefined
}

export interface HistoryContext {
  readonly host: Host
  readonly config: ResolvedConfig
  readonly resources: readonly Resource[]
  /** Messages of a resource in another version of its file, read like the current file. Undefined for embedded resources and parse errors. */
  readonly messagesIn: (resource: Resource, text: string) => ReadonlyMap<KeyString, MessageLeaf> | undefined
}

export interface HistoryProvider {
  readonly id: string
  /** Reads when each message last changed. Undefined when the provider has nothing for this project. */
  readonly load: (ctx: HistoryContext) => Promise<MessageHistory | undefined>
  /** Calls `onChange` when the history changes outside resource files, for example on a commit. */
  readonly watch?: ((ctx: HistoryContext, onChange: () => void) => Disposable) | undefined
}

/** A key that is one plural form of a base key, such as `item_one` of `item`. */
export interface PluralForm {
  readonly type: Intl.PluralRuleType
  readonly category: Intl.LDMLPluralRule
  /** The sibling key of another category. */
  readonly keyOf: (category: Intl.LDMLPluralRule) => KeyString
}

export interface CheckContext {
  readonly config: ResolvedConfig
  readonly sourceLocale: LocaleCode
  readonly locales: readonly LocaleCode[]
  /** The locales a locale falls back to, nearest first. Empty for a locale without a fallback. */
  readonly fallbacks: (locale: LocaleCode) => readonly LocaleCode[]
  readonly resources: readonly Resource[]
  /** Options from `[severity, options]` in config. */
  readonly options: JsonObject
  /** True when at least one scanner is registered. */
  readonly hasScanners: boolean
  readonly keys: () => readonly KeyString[]
  readonly messages: (locale?: LocaleCode) => Iterable<Message>
  readonly message: (key: KeyString, locale: LocaleCode) => Message | undefined
  /** Every resource message of a key in a locale, more than one when duplicated across files. */
  readonly duplicates: (key: KeyString, locale: LocaleCode) => readonly Message[]
  /** The plural form a key is, from the `{plural}` and `{ordinal}` derived-key rules. */
  readonly formOf: (key: KeyString) => PluralForm | undefined
  readonly usages: () => Iterable<Usage>
  readonly coverage: () => readonly LocaleCoverage[]
  readonly unused: () => readonly KeyString[]
  /** Usages whose key is not defined in the source locale. */
  readonly undefinedUsages: () => readonly Usage[]
  readonly placeholders: (value: string) => readonly Placeholder[]
  readonly placeholderSyntaxes: readonly PlaceholderSyntax[]
  /** Errors reported by the `validate` of every placeholder syntax. */
  readonly syntaxErrors: (value: string) => readonly string[]
  readonly localeInfo: (code: LocaleCode) => LocaleInfo
  readonly text: (path: string) => string | undefined
  readonly hardStrings: () => Iterable<HardString & { readonly path: string }>
  /** When a message last changed, from the history providers. Undefined until history is loaded. */
  readonly history: (key: KeyString, locale: LocaleCode) => MessageChange | undefined
  readonly reviews: (filter?: ReviewFilter) => readonly ReviewThread[]
}

export interface Check {
  readonly id: string
  readonly defaultSeverity: Severity | 'off'
  readonly description?: string | undefined
  readonly docs?: string | undefined
  readonly override?: boolean | undefined
  readonly run: (ctx: CheckContext) => Iterable<DiagnosticInput>
}

export interface ReportSummary {
  readonly errors: number
  readonly warnings: number
  readonly infos: number
  readonly files: number
}

export interface ReportInput {
  readonly project: string
  /** File text, for code frames and line numbers. */
  readonly text: (path: string) => string | undefined
  readonly diagnostics: readonly Diagnostic[]
  readonly coverage: readonly LocaleCoverage[]
  readonly summary: ReportSummary
}

/** What a check baseline left out (`x18n check --baseline`). */
export interface BaselineSummary {
  /** Known diagnostics that the baseline left out of the report. */
  readonly suppressed: number
  /** Baseline entries that no longer occur, to drop with `--update-baseline`. */
  readonly fixed: number
}

export interface ReporterContext {
  /** Turns a project path into the path to print (relative to the cwd). */
  readonly displayPath: (path: string, project: string) => string
  readonly color: boolean
  /** Set when a baseline applies; the inputs then hold only new diagnostics. */
  readonly baseline?: BaselineSummary | undefined
}

export interface Reporter {
  readonly id: string
  readonly override?: boolean | undefined
  readonly report: (inputs: readonly ReportInput[], ctx: ReporterContext) => string | Promise<string>
}

export interface PlaceholderSyntax {
  readonly id: string
  readonly find: (value: string) => readonly Placeholder[]
  /** Syntax errors in a value, for the `invalid-syntax` check. */
  readonly validate?: ((value: string) => readonly string[]) | undefined
  /** Text used in prompts, for example `{name}`. */
  readonly example?: string | undefined
  /** The placeholder name is another key (vue-i18n `@:key`, i18next `$t(key)`), which then counts as used. */
  readonly reference?: boolean | undefined
  /** Names the library always passes, which a translation may leave out or add (vue-i18n `n` and `count`). */
  readonly implicit?: readonly string[] | undefined
}

export interface KeyContext {
  readonly path: string
}

export interface ResourceTransformContext {
  readonly locale: LocaleCode
  readonly namespace: string | undefined
  readonly path: string
}

/**
 * Changes how a resource's tree maps to keys, for example Rails' top-level locale key
 * or Chrome's `{ "name": { "message": "..." } }`. Edits go to the stored paths.
 */
export interface ResourceTransform {
  /** Whether the transform applies to a resource. Default: every resource. */
  readonly applies?: ((ctx: ResourceTransformContext) => boolean) | undefined
  readonly read: (tree: MessageTree, ctx: ResourceTransformContext) => MessageTree
  /** The path in the file of a key path of the transformed tree. */
  readonly toStored: (path: readonly string[], ctx: ResourceTransformContext) => string[]
  /** Descriptions that the stored tree holds beside the messages, such as `{ "name": { "message": "...", "description": "..." } }`, keyed by `pathId(storedPath)`. */
  readonly describe?: ((tree: MessageTree, ctx: ResourceTransformContext) => ReadonlyMap<string, string>) | undefined
}

export interface PromptDraft {
  readonly rules: string[]
  readonly notes: string[]
}

export interface PromptContext {
  readonly sourceLocale: LocaleCode
  readonly targetLocale: LocaleCode
  readonly localeInfo: LocaleInfo
}

export interface Plugin {
  /** Unique, kebab-case. Built-ins use the `x18n:` prefix. */
  readonly name: string
  readonly enforce?: 'pre' | 'post' | undefined
  /** Where the plugin can run. Default 'any'. */
  readonly runtime?: 'any' | 'node' | undefined

  /** Change the config before it is final. Presets use this to set defaults. */
  readonly config?: ((config: ConfigDraft, ctx: ConfigContext) => void | Promise<void>) | undefined
  readonly configResolved?: ((config: ResolvedConfig) => void) | undefined

  readonly manifests?: readonly ManifestReader[] | undefined
  readonly localeFinders?: readonly LocaleFinder[] | undefined
  readonly formats?: readonly Format[] | undefined
  /** Formats that load their module when a file of that format is first read. */
  readonly lazyFormats?: readonly LazyFormat[] | undefined
  /** Scanners that load their module when a file they scan is first scanned. */
  readonly lazyScanners?: readonly LazyScanner[] | undefined
  readonly scanners?: readonly Scanner[] | undefined
  readonly extractors?: readonly Extractor[] | undefined
  readonly checks?: readonly Check[] | undefined
  readonly reporters?: readonly Reporter[] | undefined
  readonly placeholders?: readonly PlaceholderSyntax[] | undefined
  readonly histories?: readonly HistoryProvider[] | undefined
  /** Only one store is active: the last one, so a plugin's store replaces the built-in one. */
  readonly reviewStores?: readonly ReviewStore[] | undefined

  /** Turns raw key text into canonical form. The first plugin that returns a value wins. */
  readonly normalizeKey?: ((raw: string, ctx: KeyContext) => string | undefined) | undefined
  readonly derivedKeys?: readonly string[] | undefined
  readonly transformResource?: ResourceTransform | undefined
  readonly translatePrompt?: ((draft: PromptDraft, ctx: PromptContext) => void) | undefined
  /** Display data for a locale code. The first plugin that returns a value wins. */
  readonly localeInfo?: ((code: LocaleCode) => Partial<LocaleInfo> | undefined) | undefined
}

export interface Preset {
  readonly name: string
  /** Decides if the preset applies. Without `detect`, the preset applies only when listed in config. */
  readonly detect?: ((ctx: DetectContext) => boolean | Promise<boolean>) | undefined
  /** When true and detected, presets that come after it are not applied. */
  readonly exclusive?: boolean | undefined
  readonly plugins: readonly (Plugin | Preset)[]
}

/** A preset factory as referenced by name from YAML and JSON configs. */
export type PresetFactory = (options?: JsonObject) => Preset

/** Loads a plugin on demand, usually `() => import('./plugin')`: the module's default export creates it. */
export type PluginLoader = () => Promise<{ readonly default: () => Plugin }>

/** Loads a reporter on demand, usually `() => import('./reporter')`: the module's default export is the reporter. */
export type ReporterLoader = () => Promise<{ readonly default: Reporter }>

/** Loads a preset on demand, usually `() => import('./preset')`: the module's default export is the factory. */
export type PresetLoader = () => Promise<{ readonly default: PresetFactory }>

/** When a built-in preset applies. Cheap, so it stays loaded while the preset module does not. */
export interface PresetDetection {
  /** Without `detect`, the preset applies only when listed in config. */
  readonly detect?: ((ctx: DetectContext) => boolean | Promise<boolean>) | undefined
  /** When true and detected, presets that come after it are not applied. */
  readonly exclusive?: boolean | undefined
}

/**
 * A built-in preset split in two: the detection is always loaded; the module behind `load`
 * is imported only when it passes or the preset is listed in config.
 */
export interface PresetEntry extends PresetDetection {
  readonly load: PresetLoader
}
