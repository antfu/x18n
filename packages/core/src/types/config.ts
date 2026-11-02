import type { JsonObject, Severity } from './model'
import type { HistoryProvider, Plugin, Preset } from './plugin'
import type { ReviewAuthor } from './review'

/** Where a value comes from: an argument, or a property of an object argument. */
export interface ArgSource {
  readonly arg: number
  readonly property?: string | undefined
}

/** Where the params of a call are: the static keys of an object literal argument. */
export interface ParamsSource {
  /** Arguments that may hold the params object, in order; string arguments are skipped (`t(key, 'Default', { n })`). */
  readonly arg: number | readonly number[]
  /** Option names the library reads itself, which a message need not use (`ns`, `defaultValue`). */
  readonly options?: readonly string[] | undefined
}

/** Data that drives the AST scanners: which calls are translate calls and where the key is. */
export interface CallSpec {
  /** Function or member path: 't', '$t', 'i18n.t', 'intl.formatMessage'. */
  readonly callee: string | readonly string[]
  /** 'call' (default): the key is an argument. 'selector': the argument is `$ => $.a.b`. 'accessor': member chain on a root. */
  readonly kind?: 'call' | 'selector' | 'accessor' | undefined
  /** Which argument holds the key. Default 0. */
  readonly key?: number | ArgSource | undefined
  /** Where the namespace comes from (call option, or factory argument when `factory` is true), or a fixed namespace such as `'shared'` for a hook that wraps `useTranslation('shared')`. */
  readonly namespace?: ArgSource | string | undefined
  /** Where a key prefix comes from (`keyPrefix` option, or next-intl `useTranslations('a.b')`). */
  readonly keyPrefix?: ArgSource | undefined
  /** Where the params passed to the message are. For factories, those of the returned functions. */
  readonly params?: ParamsSource | undefined
  /** Where a default value written in code comes from; the first string found wins. For factories, that of the returned functions. */
  readonly defaultValue?: readonly ArgSource[] | undefined
  /** With a key read from a property: the property beside it that describes the message for translators, such as `'description'` for `{ id, description }`. */
  readonly description?: string | undefined
  /** The callee is a factory that returns the translate function, for example `useI18n()` returning `{ t }`. */
  readonly factory?: boolean | undefined
  /** For factories: the names of the returned translate functions. Default `['t']`. */
  readonly returns?: readonly string[] | undefined
  /** Type names that mark a parameter or prop as a translate function: ['TFunction']. */
  readonly types?: readonly string[] | undefined
}

export interface RegexScannerSpec {
  /** File extensions, without dot. */
  readonly extensions: readonly string[]
  /** Patterns with a `{key}` placeholder (i18n-ally `usageMatchRegex`), or a regex whose first group is the key. */
  readonly patterns: readonly string[]
}

export interface ResourceSpec {
  /** Path pattern with `{locale}`, `{locale?}`, `{namespace}`, `{namespaces}` and `{ext}` tokens and globs. */
  readonly pattern: string
  readonly format?: string | undefined
  /** Fixed namespace for every matching file. */
  readonly namespace?: string | undefined
  /** Fixed locale for every matching file, for patterns without `{locale}` (`package.nls.json`). */
  readonly locale?: string | undefined
  /** Run matching JS/TS files in Node instead of reading them statically. Makes them read-only. */
  readonly execute?: boolean | undefined
  /** Key separator of matching files, over `keySeparator`. `false` for files keyed by whole sentences (Laravel `lang/{locale}.json`). */
  readonly keySeparator?: string | false | undefined
}

/**
 * What splits a key into a path: `.` by default (`a.b` is `{ a: { b } }` in a nested file).
 * `false` makes keys literal, so `Welcome back.` or `Note: x` is one key (i18next `keySeparator: false`, gettext, Laravel JSON).
 */
export type KeySeparator = string | false

export type CheckLevel = Severity | 'off'
export type CheckSetting = CheckLevel | readonly [CheckLevel, JsonObject]

export interface GlossaryEntry {
  readonly term: string
  /** Translation per locale. */
  readonly translations?: { readonly [locale: string]: string } | undefined
  readonly note?: string | undefined
  readonly doNotTranslate?: boolean | undefined
}

export interface ExtractTemplate {
  /** Replacement code. `{key}` is the key, `{attr}` the attribute name, `{args}` the arguments of a template string, `{text}` the message of the hard string, for a default value, `{source}` the text as written in the file, and `{parts}` the message as the body of a template string. `{key}` and `{text}` are escaped for the quotes around them. */
  readonly template: string
  /** Hard-string kinds the template applies to, for example `jsx-text`. */
  readonly kinds?: readonly string[] | undefined
  /** File globs the template applies to. */
  readonly files?: readonly string[] | undefined
  /** Lines added once per file when missing, for example an import. */
  readonly imports?: readonly string[] | undefined
}

export interface ExtractOptions {
  /** Report hard strings as `hard-string` diagnostics. */
  readonly autoDetect?: boolean | undefined
  readonly keygen?: 'slug' | 'source' | 'random' | 'empty' | undefined
  readonly keyCase?: 'camel' | 'snake' | 'kebab' | 'dot' | undefined
  /** Template with `{fileName}`, `{dirName}` or `{component}`. */
  readonly keyPrefix?: string | undefined
  readonly keyMaxLength?: number | undefined
  /** Reuse a key when the same text exists as a source value. Default true. */
  readonly reuseExisting?: boolean | undefined
  /** Strings never extracted: an exact string such as `Elk`, or a `/regex/flags` string such as `/^v\d+/i` that matches the text. */
  readonly ignore?: readonly string[] | undefined
  /** Strings never extracted in the files of a glob, written as in `ignore`. */
  readonly ignoreByFile?: { readonly [glob: string]: readonly string[] } | undefined
  /** Attribute names whose values are text, on top of those whose last word is `title`, `label`, `text`, `placeholder`, `alt`, `content`, `description`, `message` and the like. Markup attributes outside this set are never extracted. */
  readonly attributes?: readonly string[] | undefined
  readonly ignoreAttributes?: readonly string[] | undefined
  readonly ignoreCallees?: readonly string[] | undefined
  readonly templates?: readonly (string | ExtractTemplate)[] | undefined
}

export interface UsageOptions {
  readonly include?: readonly string[] | undefined
  readonly exclude?: readonly string[] | undefined
  readonly calls?: readonly CallSpec[] | undefined
  readonly regex?: readonly RegexScannerSpec[] | undefined
  /** Callee names never counted as translate calls. */
  readonly ignoreCallees?: readonly string[] | undefined
  /** Keys (globs) that count as used, for example keys built at runtime. */
  readonly keysInUse?: readonly string[] | undefined
  /** Rules like `{key}_plural`: when `{key}` is used the derived keys count as used. Rules apply repeatedly, so with `{key}_*` the key `a_b_c` derives from both `a_b` and `a`. `*` matches one key segment. `{plural}` and `{ordinal}` match a plural or ordinal category (`one`, `few`, `other`): each locale then needs the categories of its own language, and categories the language lacks are optional. */
  readonly derivedKeys?: readonly string[] | undefined
}

export interface WriteOptions {
  readonly sort?: false | 'binary' | 'locale' | undefined
  readonly indent?: number | 'tab' | undefined
  /** i18n-ally `keepFulfilled`: `set` in one locale adds the key with an empty value to the others. */
  readonly keepFilled?: boolean | undefined
}

export interface NamespaceOptions {
  /** Separator between namespace and key in code. `.` merges the namespace into the key path. `false` keeps namespaces out of keys in code (i18next `nsSeparator: false`), so a key may hold `:`. Default `.`. */
  readonly separator?: string | false | undefined
  /** Namespace of keys written without one. */
  readonly default?: string | undefined
  /** Namespaces searched in order when a key written without a namespace is not in its own (i18next `fallbackNS`). */
  readonly fallback?: readonly string[] | undefined
  /** Namespace of keys written without one, per glob of source files, before `default`: `{ 'packages/admin/**': 'admin' }`. */
  readonly byFile?: { readonly [glob: string]: string } | undefined
  /** How `{namespaces}` folders name a namespace: `dot` makes `pages/home` into `pages.home`, `slash` keeps `pages/home`, `camel` makes `todos-page` into `todosPage`. Default `dot`. */
  readonly fromPath?: 'dot' | 'slash' | 'camel' | undefined
}

export interface ReviewOptions {
  /** Default true. */
  readonly enabled?: boolean | undefined
  /** Review file, relative to the project root. Default `.x18n/reviews.yml`. */
  readonly file?: string | undefined
  /** Author of new reviews, instead of the host identity (git `user.name` and `user.email`). */
  readonly author?: ReviewAuthor | undefined
}

export type NamespaceFromPath = NonNullable<NamespaceOptions['fromPath']>

export type PluginSpecifier = string | readonly [string, JsonObject]

/** The part of the config that YAML and JSON files can hold. Validated by `ConfigSchema`. */
export interface SerializableConfig {
  readonly $schema?: string | undefined
  /** Project root, relative to the config file. */
  readonly root?: string | undefined
  /** Project name in a monorepo. Default: the directory name. */
  readonly name?: string | undefined
  readonly sourceLocale?: string | undefined
  /** Locale codes as written in paths. Filters the found locales. */
  readonly locales?: readonly string[] | undefined
  readonly ignoreLocales?: readonly string[] | undefined
  /** Locale to the locale it falls back to, such as `{ 'en-GB': 'en' }`. A locale with a fallback holds only overrides: a key it lacks or leaves empty is not missing when the fallback chain has it. `'auto'` falls back to the nearest parent language that exists: `en-US` to `en`, `zh-Hant-TW` to `zh-Hant` or `zh`. */
  readonly localeFallbacks?: 'auto' | { readonly [locale: string]: string } | undefined
  /** `'auto'` detects built-in presets from the project's dependencies. */
  readonly presets?: 'auto' | readonly PluginSpecifier[] | undefined
  readonly plugins?: readonly PluginSpecifier[] | undefined
  readonly resources?: readonly ResourceSpec[] | undefined
  /** Explicit format id per file extension (without dot). */
  readonly formats?: { readonly [extension: string]: string } | undefined
  readonly keyStyle?: 'auto' | 'nested' | 'flat' | undefined
  /** What splits a key into a path: `a.b` is `{ a: { b } }` in a nested file. `false` makes keys literal, so `Welcome back.` or `Note: x` is one key and a new key is one property (i18next `keySeparator: false`, gettext). A resource pattern can set its own. */
  readonly keySeparator?: string | false | undefined
  readonly namespace?: NamespaceOptions | undefined
  readonly usage?: UsageOptions | undefined
  readonly write?: WriteOptions | undefined
  readonly extract?: ExtractOptions | undefined
  /** Overrides on top of the `recommended` check set. */
  readonly checks?: { readonly [checkId: string]: CheckSetting } | undefined
  /** Turn every warning into an error. */
  readonly strict?: boolean | undefined
  /** Keys (globs) excluded from all checks. */
  readonly ignoreKeys?: readonly string[] | undefined
  readonly glossary?: readonly GlossaryEntry[] | undefined
  /** History providers for stale translations. `false` turns every provider off. Options of a provider sit under its key, such as `git: { maxDepth, since }` (or `git: false`). */
  readonly history?: boolean | HistoryOptions | undefined
  /** Review comments, approvals and suggested values on messages, kept in a file tracked in git. */
  readonly review?: ReviewOptions | undefined
  /** Monorepo: directories (globs) that are projects inheriting this config. */
  readonly projects?: readonly string[] | undefined
}

/** Check ids of known plugins, for autocompletion. Plugins add theirs through declaration merging. */

export interface CheckIds {}

/** Options of plugins under their own config key. Plugins add theirs through declaration merging. */

export interface PluginConfigs {}

/** Options of history providers under their own key, such as `git`. Providers add theirs through declaration merging. */

export interface HistoryConfigs {}

export type HistoryOptions = Partial<HistoryConfigs>

export interface HistorySettings extends HistoryOptions {
  /** Providers asked before those of plugins. */
  readonly providers: readonly HistoryProvider[]
}

export type PresetOption = Preset | PluginSpecifier | false | undefined
export type PluginOption = Plugin | Preset | PluginSpecifier | false | undefined

/** The config accepted by `defineConfig`: the serializable part plus plugin objects. */
export interface UserConfig extends Omit<SerializableConfig, 'presets' | 'plugins' | 'checks' | 'history'> {
  readonly presets?: 'auto' | readonly PresetOption[] | undefined
  /** History providers for stale translations: `false` turns them off; provider options such as `git` sit under their key; `providers` adds providers asked first. */
  readonly history?: boolean | (HistoryOptions & { readonly providers?: readonly HistoryProvider[] | undefined }) | undefined
  readonly plugins?: readonly PluginOption[] | undefined
  readonly checks?: { readonly [K in keyof CheckIds]?: CheckSetting } & { readonly [checkId: string]: CheckSetting } | undefined
  readonly pluginConfigs?: Partial<PluginConfigs> | undefined
}

export type ConfigOrigin = 'default' | 'user' | 'parent' | `plugin:${string}`

/** The final config of one project. Every field is set. */
export interface ResolvedConfig {
  readonly name: string
  readonly sourceLocale: string
  readonly locales: readonly string[] | undefined
  readonly ignoreLocales: readonly string[]
  readonly localeFallbacks: 'auto' | { readonly [locale: string]: string }
  readonly resources: readonly ResourceSpec[]
  readonly formats: { readonly [extension: string]: string }
  readonly keyStyle: 'auto' | 'nested' | 'flat'
  readonly keySeparator: KeySeparator
  readonly namespace: {
    readonly separator: string | false
    readonly default: string | undefined
    readonly fallback: readonly string[]
    readonly byFile: { readonly [glob: string]: string }
    readonly fromPath: NamespaceFromPath
  }
  readonly usage: {
    readonly include: readonly string[]
    readonly exclude: readonly string[]
    readonly calls: readonly CallSpec[]
    readonly regex: readonly RegexScannerSpec[]
    readonly ignoreCallees: readonly string[]
    readonly keysInUse: readonly string[]
    readonly derivedKeys: readonly string[]
  }
  readonly write: { readonly sort: false | 'binary' | 'locale', readonly indent: number | 'tab' | undefined, readonly keepFilled: boolean }
  readonly extract: ExtractOptions
  readonly checks: { readonly [checkId: string]: CheckSetting }
  readonly strict: boolean
  readonly ignoreKeys: readonly string[]
  readonly glossary: readonly GlossaryEntry[]
  readonly history: false | HistorySettings
  readonly review: { readonly enabled: boolean, readonly file: string, readonly author: ReviewAuthor | undefined }
  readonly pluginConfigs: Partial<PluginConfigs>
  /** Origin of each top-level value, for `explain()`. */
  readonly origins: { readonly [key: string]: ConfigOrigin }
}

/** A mutable view of the config that `config` hooks change. */
export type ConfigDraft = {
  -readonly [K in keyof Omit<ResolvedConfig, 'origins' | 'name'>]: ResolvedConfig[K]
}
