import type { X18nError } from '../errors'
import type { PluginRegistry } from '../plugins'
import type { CheckSetting, ResolvedConfig } from '../types/config'
import type { Diagnostic, JsonObject, KeyString, LocaleCode, LocaleInfo, Message, MessageState, MessageTree, NodeRange, Placeholder, Resource, Severity, Usage } from '../types/model'
import type { Check, CheckContext, DiagnosticInput, HardString, LocaleCoverage, MessageChange, PluralForm, ScanResult } from '../types/plugin'
import type { Analysis } from '../types/project'
import { keyMatcher } from '../keys'
import { fallbackChain } from '../locale'
import { isOutdated } from './history'
import { dynamicReach } from './unused'
import { categoriesOf } from './usages'

export interface ResourceState {
  readonly resource: Resource
  readonly hash: string
  readonly content: string
  /** Offset of the content in the file (non-zero for blocks). */
  readonly offset: number
  /** Keys as the project sees them, after resource transforms. */
  readonly tree: MessageTree
  /** The tree as stored in the file. Edits work on it. */
  readonly rawTree: MessageTree
  /** Maps a key path of `tree` to its path in `rawTree`. */
  readonly toStored: (path: readonly string[]) => string[]
  readonly ranges: ReadonlyMap<string, NodeRange>
  /** Descriptions of messages from the format and the transforms, keyed by `pathId(storedPath)`. */
  readonly descriptions: ReadonlyMap<string, string>
  readonly states: ReadonlyMap<string, MessageState>
  readonly labels: ReadonlyMap<string, string>
  readonly error: X18nError | undefined
  /** Read by running the file (`execute: true`), not by parsing it. */
  readonly execute: boolean
}

interface AnalyzerState {
  readonly revision: number
  readonly sourceLocale: LocaleCode
  readonly locales: readonly LocaleCode[]
  readonly fallbacks: Readonly<Record<LocaleCode, LocaleCode>>
  readonly resources: readonly ResourceState[]
  readonly resourceErrors: readonly { readonly error: X18nError, readonly path: string }[]
  readonly scanErrors: readonly { readonly error: X18nError, readonly path: string }[]
  readonly discoveryErrors: readonly { readonly error: X18nError, readonly path: string }[]
  readonly messages: ReadonlyMap<KeyString, ReadonlyMap<LocaleCode, readonly Message[]>>
  readonly parents: ReadonlySet<KeyString>
  readonly usages: readonly Usage[]
  readonly usagesByKey: ReadonlyMap<KeyString, readonly Usage[]>
  readonly prefixUsages: readonly Usage[]
  readonly derived: ReadonlyMap<KeyString, readonly KeyString[]>
  readonly files: ReadonlyMap<string, { readonly result: ScanResult }>
  readonly history: (key: KeyString, locale: LocaleCode) => MessageChange | undefined
  /** Targets the review records mark as written against the current source value. */
  readonly fresh: (key: KeyString, locale: LocaleCode) => boolean
  readonly reviews: CheckContext['reviews']
}

export interface AnalyzerOptions {
  readonly config: ResolvedConfig
  readonly registry: PluginRegistry
  readonly state: () => AnalyzerState
  readonly basesOf: (key: KeyString) => readonly KeyString[]
  readonly formOf: (key: KeyString) => PluralForm | undefined
  readonly localeInfo: (code: LocaleCode) => LocaleInfo
  readonly text: (path: string) => string | undefined
  /** Whether keys carry a namespace; a scoped dynamic usage reaches only keys of its namespace. */
  readonly namespaced: () => boolean
}

function levelOf(setting: CheckSetting | undefined): { level: Severity | 'off', options: JsonObject } | undefined {
  if (setting === undefined)
    return undefined
  if (typeof setting === 'string')
    return { level: setting, options: {} }
  return { level: setting[0], options: setting[1] }
}

/**
 * The keys a locale needs: the reference keys, with plural forms swapped for the categories of the locale's
 * language. Forms the language lacks or may leave out (`item_zero` in English, `item_many` in French) count only where they exist.
 */
function expectedKeys(state: AnalyzerState, options: AnalyzerOptions, reference: readonly KeyString[], locale: LocaleCode): KeyString[] {
  const info = options.localeInfo(locale)
  const keys = new Set<KeyString>()
  for (const key of reference) {
    const form = options.formOf(key)
    if (!form || state.messages.get(key)?.has(locale))
      keys.add(key)
    form && categoriesOf(info, form.type, true).forEach(category => keys.add(form.keyOf(category)))
  }
  return [...keys].sort()
}

function computeCoverage(state: AnalyzerState, options: AnalyzerOptions, sourceKeys: readonly KeyString[]): LocaleCoverage[] {
  const { messages, sourceLocale } = state
  return state.locales.map((locale) => {
    const reference = expectedKeys(state, options, sourceKeys, locale)
    const chain = fallbackChain(state.fallbacks, locale)
    // A variant holds overrides only: what its fallbacks have is inherited, not missing.
    const inherited = (key: KeyString): boolean => chain.some((code) => {
      const value = messages.get(key)?.get(code)?.[0]?.value
      return value !== undefined && value !== ''
    })
    const missing: KeyString[] = []
    const empty: KeyString[] = []
    const outdated: KeyString[] = []
    const needsReview: KeyString[] = []
    const reviewed: KeyString[] = []
    for (const key of reference) {
      const message = messages.get(key)?.get(locale)?.[0]
      const value = message?.value
      if (value === undefined || value === '') {
        if (inherited(key))
          continue
        (value === undefined
          ? missing
          : empty).push(key)
        continue
      }
      if (locale !== sourceLocale && isOutdated(state.history(key, sourceLocale), state.history(key, locale)) && !state.fresh(key, locale))
        outdated.push(key)
      if (message?.state === 'needs-review')
        needsReview.push(key)
      else if (message?.state === 'reviewed')
        reviewed.push(key)
    }
    return {
      locale,
      total: reference.length,
      translated: reference.length - missing.length - empty.length,
      missing,
      empty,
      outdated,
      needsReview,
      reviewed,
    }
  })
}

function errorDiagnostics(state: AnalyzerState): Diagnostic[] {
  return [
    ...state.discoveryErrors,
    ...state.resourceErrors,
    ...state.scanErrors,
  ].map(({ error, path }) => ({
    code: 'invalid-resource',
    severity: error.code.startsWith('X18N3')
      ? 'warning'
      : 'error',
    message: `${error.message} (${error.code})`,
    key: undefined,
    locale: undefined,
    location: {
      path,
      range: { start: 0, end: 0 },
    },
    fixes: [],
  }))
}

interface RunChecksInput {
  readonly config: ResolvedConfig
  readonly registry: PluginRegistry
  readonly ctx: Omit<CheckContext, 'options'>
  readonly state: AnalyzerState
  readonly ignored: (key: KeyString) => boolean
}

function* runCheck(check: Check, level: Severity, inputs: Iterable<DiagnosticInput>, input: RunChecksInput): Generator<Diagnostic> {
  const { state, config } = input
  const resourcePath = (id: string): string => state.resources.find(s => s.resource.id === id)?.resource.path ?? id
  for (const item of inputs) {
    if (item.key !== undefined && input.ignored(item.key))
      continue
    const severity = config.strict && (item.severity ?? level) === 'warning'
      ? 'error'
      : item.severity ?? level
    let location = item.location
    if (!location && item.key !== undefined) {
      // A plural form only a target locale needs (`item_few`) sits at the source's `other` form.
      const byLocale = state.messages.get(item.key) ?? state.messages.get(input.ctx.formOf(item.key)?.keyOf('other') ?? item.key)
      const found = byLocale?.get(item.locale ?? state.sourceLocale)?.[0] ?? byLocale?.get(state.sourceLocale)?.[0]
      if (found) {
        location = {
          path: resourcePath(found.resource),
          range: found.range?.key ?? { start: 0, end: 0 },
        }
      }
    }
    yield {
      code: check.id,
      severity,
      message: item.message,
      key: item.key,
      locale: item.locale,
      location,
      fixes: item.fixes ?? [],
    }
  }
}

function runChecks(input: RunChecksInput): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const check of input.registry.checks.values()) {
    const setting = levelOf(input.config.checks[check.id]) ?? { level: check.defaultSeverity, options: {} }
    if (setting.level === 'off')
      continue
    try {
      out.push(...runCheck(check, setting.level, check.run({ ...input.ctx, options: setting.options }), input))
    }
    catch (error) {
      out.push({
        code: check.id,
        severity: 'error',
        message: `Check failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
        key: undefined,
        locale: undefined,
        location: undefined,
        fixes: [],
      })
    }
  }
  return out
}

export function createAnalyzer(options: AnalyzerOptions): { readonly analyze: () => Analysis } {
  const { config, registry } = options
  let memo: Analysis | undefined
  const ignored = keyMatcher(config.ignoreKeys, config.keySeparator)
  const inUse = keyMatcher(config.usage.keysInUse, config.keySeparator)
  // Values rarely change between revisions; finding placeholders is the cost of several checks.
  const placeholderCache = new Map<string, readonly Placeholder[]>()

  function analyze(): Analysis {
    const state = options.state()
    if (memo && memo.revision === state.revision)
      return memo
    const { sourceLocale, locales, messages } = state
    const sourceKeys = [
      ...messages.keys(),
    ].filter(key => messages.get(key)?.has(sourceLocale)).sort()
    const allKeys = [
      ...messages.keys(),
    ].sort()
    const reference = sourceKeys.length > 0
      ? sourceKeys
      : allKeys

    const coverage = computeCoverage(state, options, reference)

    const isDefined = (key: KeyString): boolean =>
      messages.get(key)?.has(sourceLocale) === true
      || state.parents.has(key)
      || (state.derived.get(key)?.length ?? 0) > 0
      || (sourceKeys.length === 0 && messages.has(key))

    // Without scanned source files every key would look unused.
    const hasScanners = state.files.size > 0
    const referenceSyntaxes = registry.placeholders.filter(syntax => syntax.reference)
    const referenced = new Set<KeyString>()
    if (referenceSyntaxes.length > 0) {
      for (const byLocale of messages.values()) {
        const value = byLocale.get(sourceLocale)?.[0]?.value
        if (typeof value === 'string')
          referenceSyntaxes.forEach(syntax => syntax.find(value).forEach(p => referenced.add(p.name)))
      }
    }
    const prefixes = [
      ...new Set(state.prefixUsages.flatMap(usage => usage.key === undefined
        ? []
        : [usage.key])),
    ]
    const isUsed = (key: KeyString): boolean => {
      if (state.usagesByKey.has(key) || inUse(key) || referenced.has(key))
        return true
      if (options.basesOf(key).some(base => state.usagesByKey.has(base) || inUse(base)))
        return true
      return prefixes.some(prefix => key.startsWith(prefix))
    }
    const unused = hasScanners
      ? allKeys.filter(key => !isUsed(key))
      : []
    const reach = dynamicReach(state.usages, options.namespaced())
    const undefinedUsages = state.usages.filter(usage =>
      usage.dynamic === false && usage.key !== undefined && !isDefined(usage.key))

    const placeholders = (value: string): ReturnType<CheckContext['placeholders']> => {
      let found = placeholderCache.get(value)
      if (!found) {
        found = registry.placeholders.flatMap(syntax => syntax.find(value)).sort((a, b) => a.range.start - b.range.start)
        if (placeholderCache.size > 100_000)
          placeholderCache.clear()
        placeholderCache.set(value, found)
      }
      return found
    }

    const baseCtx: Omit<CheckContext, 'options'> = {
      config,
      sourceLocale,
      locales,
      fallbacks: locale => fallbackChain(state.fallbacks, locale),
      resources: state.resources.map(s => s.resource),
      hasScanners,
      keys: () => allKeys,
      * messages(locale) {
        for (const byLocale of messages.values()) {
          for (const [code, list] of byLocale) {
            if (locale === undefined || code === locale)
              yield list[0]!
          }
        }
      },
      message: (key, locale) => messages.get(key)?.get(locale)?.[0],
      duplicates: (key, locale) => messages.get(key)?.get(locale) ?? [],
      formOf: options.formOf,
      usages: () => state.usages,
      coverage: () => coverage,
      unused: () => unused,
      dynamicUsages: reach.reaching,
      undefinedUsages: () => undefinedUsages,
      placeholders,
      placeholderSyntaxes: registry.placeholders,
      syntaxErrors: value => registry.placeholders.flatMap(syntax => syntax.validate?.(value) ?? []),
      localeInfo: options.localeInfo,
      text: options.text,
      history: state.history,
      reviews: state.reviews,
      * hardStrings(): Generator<HardString & { readonly path: string }> {
        for (const [path, file] of state.files) {
          for (const hard of file.result.hardStrings ?? [])
            yield { ...hard, path }
        }
      },
    }

    const diagnostics = [
      ...errorDiagnostics(state),
      ...runChecks({
        config,
        registry,
        ctx: baseCtx,
        state,
        ignored,
      }),
    ]

    diagnostics.sort((a, b) =>
      (a.location?.path ?? '').localeCompare(b.location?.path ?? '')
      || (a.location?.range.start ?? 0) - (b.location?.range.start ?? 0)
      || a.code.localeCompare(b.code))

    memo = {
      revision: state.revision,
      diagnostics,
      coverage,
      unused,
      undefinedUsages,
    }
    return memo
  }

  return { analyze }
}
