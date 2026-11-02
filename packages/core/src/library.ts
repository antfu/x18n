import type { CallSpec, ConfigDraft, ExtractTemplate, KeySeparator, NamespaceFromPath, RegexScannerSpec, ResourceSpec } from './types/config'
import type { ConfigContext, LocaleFinder, PlaceholderSyntax, Plugin, ResourceTransform } from './types/plugin'

export interface LibraryOptions {
  /** The plugin name, prefixed by the caller: `x18n:vue-i18n`. */
  readonly name: string
  readonly calls?: readonly CallSpec[]
  /** i18n-ally style `usageMatchRegex` patterns, for languages without an AST scanner. */
  readonly regex?: readonly RegexScannerSpec[]
  /** The library's placeholder syntaxes. */
  readonly placeholders?: readonly PlaceholderSyntax[]
  readonly derivedKeys?: readonly string[]
  readonly namespace?: { readonly separator?: string, readonly default?: string, readonly fromPath?: NamespaceFromPath }
  /** Default resource patterns (i18n-ally `preferredLocalePaths` + `pathMatcher`). */
  readonly resources?: readonly ResourceSpec[]
  readonly keyStyle?: 'nested' | 'flat'
  /** The library's key separator; `false` for literal keys (gettext). The user's `keySeparator` wins. */
  readonly keySeparator?: KeySeparator
  readonly templates?: readonly ExtractTemplate[]
  readonly finders?: readonly LocaleFinder[]
  readonly normalizeKey?: Plugin['normalizeKey']
  readonly transformResource?: ResourceTransform
  readonly extra?: (draft: ConfigDraft, ctx: ConfigContext) => void | Promise<void>
  readonly translatePrompt?: Plugin['translatePrompt']
}

/** One plugin holding a library's call specs, regexes, namespace rules, defaults and extraction templates. */
export function createLibraryPlugin(options: LibraryOptions): Plugin {
  return {
    name: options.name,
    async config(draft, ctx) {
      if (options.namespace) {
        draft.namespace = {
          ...draft.namespace,
          separator: options.namespace.separator ?? draft.namespace.separator,
          default: draft.namespace.default ?? options.namespace.default,
          fromPath: options.namespace.fromPath ?? draft.namespace.fromPath,
        }
      }
      // Defaults of every detected library add up; a user `resources` replaces them all.
      if (options.resources) {
        draft.resources = [
          ...draft.resources,
          ...options.resources.filter(spec => !draft.resources.some(r => r.pattern === spec.pattern)),
        ]
      }
      if (options.keyStyle && draft.keyStyle === 'auto' && !ctx.user.keyStyle)
        draft.keyStyle = options.keyStyle
      if (options.keySeparator !== undefined && ctx.user.keySeparator === undefined)
        draft.keySeparator = options.keySeparator
      draft.usage = {
        ...draft.usage,
        calls: [
          ...draft.usage.calls,
          ...options.calls ?? [],
        ],
        regex: [
          ...draft.usage.regex,
          ...options.regex ?? [],
        ],
        derivedKeys: [
          ...draft.usage.derivedKeys,
          ...options.derivedKeys ?? [],
        ],
      }
      await options.extra?.(draft, ctx)
    },
    placeholders: options.placeholders,
    localeFinders: options.finders,
    normalizeKey: options.normalizeKey,
    transformResource: options.transformResource,
    translatePrompt: options.translatePrompt,
    extractors: options.templates
      ? [
          { id: options.name, templates: options.templates },
        ]
      : undefined,
  }
}
