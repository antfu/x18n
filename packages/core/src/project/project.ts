import type { X18nError } from '../errors'
import type { Setup } from '../resolve'
import type { KeySeparator } from '../types/config'
import type { FileEvent, Host } from '../types/host'
import type { KeyString, LocaleCode, LocaleInfo, Message, MessageLeaf, MessageTree, Resource, TextRange, Usage } from '../types/model'
import type { FinderContext, HardString, HistoryContext, KeyFile, ScanResult, SourceFile } from '../types/plugin'
import type { Analysis, KeyInfo, KeyTarget, Project, ProjectChange, ProjectExplanation, ResourceNode, SearchMatch, SearchOptions, UsageMatch } from '../types/project'
import type { ReviewData, ReviewFilter, ReviewThread } from '../types/review'
import type { ResourceState } from './analysis'
import type { ReviewSource } from './planner'
import type { UsageResolver } from './usages'
import { errors, isX18nError, toErrorInfo } from '../errors'
import { fuzzyScore } from '../fuzzy'
import { isKeyUnder, joinKey, keyMatcher, keySeparatorOf, pathMatcher, splitKeyPath } from '../keys'
import { parseLocaleInfo, resolveFallbacks } from '../locale'
import { isMessageLeaf, isMessageTree, pathId, walkLeaves } from '../message-tree'
import { extensionOf } from '../plugins'
import { hashText, rangeContains } from '../text'
import { createAnalyzer } from './analysis'
import { planFixes } from './fixes'
import { createHistory } from './history'
import { createPlanner } from './planner'
import { buildPrompt } from './prompt'
import { listThreads, noReviews, sourceHash } from './reviews'
import { planUnusedDeletion } from './unused'
import { categoriesOf, createUsageResolver, derivedKeys, prefixMatches, suppressedRanges } from './usages'

export interface CreateProjectOptions {
  readonly host: Host
  readonly setup: Setup
}

interface FileState {
  readonly hash: string
  readonly text: string
  readonly result: ScanResult
  readonly error: X18nError | undefined
}

interface Candidate {
  readonly path: string
  readonly locale: LocaleCode
  readonly namespace: string | undefined
  readonly format: string | undefined
  readonly block: Resource['block']
  readonly readonly: boolean
  readonly finder: string
  /** Set only when it differs from the config's `keySeparator`. */
  readonly keySeparator?: KeySeparator | undefined
}

// Caps file reads and scans in flight, so large projects stay under the open file limit.
const ioConcurrency = 64

async function forEachLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length)
      await fn(items[next++]!)
  }
  await Promise.all(Array.from({
    length: Math.min(limit, items.length),
  }, worker))
}

interface ResourceIndex {
  readonly messages: Map<KeyString, Map<LocaleCode, Message[]>>
  readonly keyPaths: Map<KeyString, { namespace: string | undefined, path: string[] }>
  readonly nodes: Map<string, ResourceNode[]>
  readonly parents: Set<KeyString>
  readonly derived: Map<KeyString, KeyString[]>
}

export function createProject(options: CreateProjectOptions): Project {
  const { host, setup } = options
  const { config, registry } = setup
  const listeners = new Set<(change: ProjectChange) => void>()
  const fileTexts = new Map<string, string>()
  const resourceStates = new Map<string, ResourceState>()
  const files = new Map<string, FileState>()
  const discoveryErrors: { error: X18nError, path: string }[] = []
  let duplicates: { path: string, finder: string, keptFrom: string }[] = []
  let finderResults: { id: string, resources: string[] }[] = []
  let revision = 0
  let namespaced = false
  let locales: LocaleCode[] = []
  let fallbacks: Readonly<Record<LocaleCode, LocaleCode>> = {}
  let sourceLocale: LocaleCode = config.sourceLocale
  let resolver: UsageResolver
  let watcher: { dispose: () => void } | undefined
  let usageEligible: (path: string) => boolean = () => false
  // Rebuilt only when resources change, so a source edit re-indexes just its usages.
  let resourceIndex: ResourceIndex | undefined
  let resolved = new WeakMap<FileState, Usage[]>()
  const reviewFile = config.review.file
  let reviewText: string | undefined
  let reviewData: ReviewData = noReviews
  let reviewError: X18nError | undefined

  const normalizers = registry.plugins.flatMap(plugin => plugin.normalizeKey
    ? [plugin.normalizeKey]
    : [])
  const transforms = registry.plugins.flatMap(plugin => plugin.transformResource
    ? [plugin.transformResource]
    : [])
  const localeInfoHooks = registry.plugins.flatMap(plugin => plugin.localeInfo
    ? [plugin.localeInfo]
    : [])
  const { basesOf, formOf } = derivedKeys(config.usage.derivedKeys)
  const scanSignature = hashText(JSON.stringify({
    usage: config.usage,
    namespace: config.namespace,
    scanners: registry.scanners.map(s => s.id),
    v: 1,
  }))
  const localeFilter = (code: LocaleCode): boolean =>
    (!config.locales || config.locales.includes(code)) && !config.ignoreLocales.includes(code)

  const infoCache = new Map<LocaleCode, LocaleInfo>()
  function localeInfo(code: LocaleCode): LocaleInfo {
    let info = infoCache.get(code)
    if (!info) {
      info = parseLocaleInfo(code)
      for (const hook of localeInfoHooks) {
        const result = hook(code)
        if (result) {
          info = {
            ...info,
            ...result,
            code,
          }
          break
        }
      }
      infoCache.set(code, info)
    }
    return info
  }

  /** Whether `locale` needs `key`: not a plural form of a category its language lacks or may leave out. */
  function needs(key: KeyString, locale: LocaleCode): boolean {
    const form = formOf(key)
    return !form || categoriesOf(localeInfo(locale), form.type, true).includes(form.category)
  }

  // ---- Reviews ----

  // A plugin's store replaces the built-in one, which comes first.
  const reviewStore = config.review.enabled
    ? registry.reviewStores.at(-1)
    : undefined

  async function loadReviews(): Promise<void> {
    if (!reviewStore)
      return
    reviewText = await host.readFile(reviewFile)
    reviewError = undefined
    reviewData = noReviews
    if (reviewText === undefined)
      return
    try {
      reviewData = reviewStore.parse(reviewText)
    }
    catch (error) {
      reviewError = errors.X18N5001({
        path: reviewFile,
        reason: error instanceof Error
          ? error.message
          : String(error),
        cause: error,
      })
    }
  }

  /** Reviews the planner may change: none while the file cannot be read, so a write never drops what is in it. */
  function reviewSource(): ReviewSource | undefined {
    return reviewStore && !reviewError
      ? {
          store: reviewStore,
          file: reviewFile,
          text: reviewText,
          data: reviewData,
        }
      : undefined
  }

  function reviewProblem(): string {
    return reviewError?.message ?? (config.review.enabled
      ? 'no review store is registered'
      : '`review.enabled` is false')
  }

  function reviews(filter: ReviewFilter = {}): ReviewThread[] {
    return listThreads(reviewData, filter, locales, (key, locale) => message(key, locale)?.value)
  }

  /** A target recorded as written against the current source value. */
  function fresh(key: KeyString, locale: LocaleCode): boolean {
    const recorded = reviewData.sources[key]?.[locale]
    const source = message(key, sourceLocale)?.value
    return recorded !== undefined && source !== undefined && recorded === sourceHash(source)
  }

  // ---- Discovery and parse ----

  function finderContext(): FinderContext {
    return {
      host,
      config,
      extensions: [
        ...new Set(registry.formats.flatMap(format => format.extensions)),
      ],
    }
  }

  async function discover(): Promise<Candidate[]> {
    const ctx = finderContext()
    const seen = new Map<string, string>()
    const out: Candidate[] = []
    duplicates = []
    finderResults = []
    for (const finder of registry.finders) {
      const found = await finder.find(ctx)
      const kept: string[] = []
      for (const candidate of found) {
        const id = candidate.block
          ? `${candidate.path}#${candidate.block.index}`
          : candidate.path
        const previous = seen.get(id)
        if (previous) {
          duplicates.push({ path: id, finder: finder.id, keptFrom: previous })
          continue
        }
        seen.set(id, finder.id)
        if (!localeFilter(candidate.locale))
          continue
        kept.push(id)
        out.push({
          path: candidate.path,
          locale: candidate.locale,
          namespace: candidate.namespace,
          format: candidate.format,
          block: candidate.block,
          readonly: candidate.readonly === true,
          finder: finder.id,
          keySeparator: candidate.keySeparator === config.keySeparator
            ? undefined
            : candidate.keySeparator,
        })
      }
      finderResults.push({ id: finder.id, resources: kept })
    }
    return out
  }

  /** Namespace and key path of a stored path: each stored segment is split by the resource's key separator. */
  function keyIdFor(resource: Resource, stored: readonly string[]): { namespace: string | undefined, path: string[] } {
    const separator = keySeparatorOf(resource, config.keySeparator)
    const logical = stored.flatMap(segment => splitKeyPath(segment, separator))
    if (namespaced)
      return { namespace: resource.namespace ?? config.namespace.default, path: logical }
    return {
      namespace: undefined,
      path: [
        ...resource.namespace
          ? resource.namespace.split('.')
          : [],
        ...logical,
      ],
    }
  }

  function keyFor(resource: Resource, stored: readonly string[]): KeyString {
    const { namespace, path } = keyIdFor(resource, stored)
    return joinKey(namespace, path, config.keySeparator)
  }

  /** Key path to stored path through the transforms that apply to a resource, last first. */
  function storedPathOf(ctx: { path: string, locale: LocaleCode, namespace: string | undefined }): (path: readonly string[]) => string[] {
    const active = transforms.filter(transform => transform.applies?.(ctx) !== false)
    if (active.length === 0)
      return path => [...path]
    return path => active.reduceRight<string[]>((current, transform) => transform.toStored(current, ctx), [...path])
  }

  function parseResource(candidate: Candidate, text: string): ResourceState {
    const format = registry.formatFor(candidate.path, candidate.format)
    const id = candidate.block
      ? `${candidate.path}#${candidate.block.index}`
      : candidate.path
    const resource: Resource = {
      id,
      path: candidate.path,
      locale: candidate.locale,
      namespace: candidate.namespace,
      format: format?.id ?? 'unknown',
      block: candidate.block,
      readonly: candidate.readonly || !format || (!format.edit && !format.serialize),
      finder: candidate.finder,
      ...candidate.keySeparator === undefined
        ? {}
        : { keySeparator: candidate.keySeparator },
    }
    const content = candidate.block
      ? text.slice(candidate.block.range.start, candidate.block.range.end)
      : text
    const offset = candidate.block?.range.start ?? 0
    const ctx = {
      path: candidate.path,
      locale: candidate.locale,
      namespace: candidate.namespace,
      indent: config.write.indent,
    }
    const base = {
      resource,
      hash: hashText(content),
      content,
      offset,
      toStored: storedPathOf(ctx),
    }
    if (!format) {
      return {
        ...base,
        tree: {},
        rawTree: {},
        ranges: new Map(),
        descriptions: new Map(),
        states: new Map(),
        labels: new Map(),
        error: errors.X18N2001({ path: candidate.path }),
      }
    }
    try {
      const parsed = format.parse(content, ctx)
      let tree: MessageTree = parsed.tree
      const descriptions = new Map(parsed.descriptions)
      for (const transform of transforms) {
        if (transform.applies?.(ctx) === false)
          continue
        tree = transform.read(tree, ctx)
        for (const [id, description] of transform.describe?.(parsed.tree, ctx) ?? [])
          descriptions.set(id, description)
      }
      if (!isMessageTree(tree))
        throw errors.X18N2003({ path: candidate.path })
      return {
        ...base,
        tree,
        rawTree: parsed.tree,
        ranges: parsed.ranges ?? new Map(),
        descriptions,
        states: parsed.states ?? new Map(),
        labels: parsed.labels ?? new Map(),
        error: undefined,
      }
    }
    catch (error) {
      const coded = isX18nError(error)
        ? error
        : errors.X18N2002({
            path: candidate.path,
            reason: error instanceof Error
              ? error.message
              : String(error),
            cause: error,
          })
      return {
        ...base,
        tree: {},
        rawTree: {},
        ranges: new Map(),
        descriptions: new Map(),
        states: new Map(),
        labels: new Map(),
        error: coded,
      }
    }
  }

  function messagesIn(resource: Resource, text: string): ReadonlyMap<KeyString, MessageLeaf> | undefined {
    if (resource.block)
      return undefined
    const format = resource.format === 'unknown'
      ? undefined
      : resource.format
    const state = parseResource({ ...resource, format, block: undefined }, text)
    if (state.error)
      return undefined
    return new Map([
      ...walkLeaves(state.tree),
    ].map(leaf => [
      keyFor(state.resource, leaf.path),
      leaf.value,
    ]))
  }

  /** A path for a new resource, from the locale finders. */
  function newResourcePath(locale: LocaleCode, namespace: string | undefined, model: Resource | undefined): string | undefined {
    const ctx = finderContext()
    for (const finder of registry.finders) {
      const path = finder.resolveNew?.({ locale, namespace, model }, ctx)
      if (path)
        return path
    }
    return undefined
  }

  /** The file of one key, from the locale finders. */
  function keyFile(key: KeyString, locale: LocaleCode): KeyFile | undefined {
    const finders = registry.finders.filter(finder => finder.resolveKey)
    if (finders.length === 0)
      return undefined
    const ctx = finderContext()
    for (const finder of finders) {
      const file = finder.resolveKey?.({ key, locale }, ctx)
      if (file)
        return file
    }
    return undefined
  }

  async function loadResources(candidates: readonly Candidate[], reread: ReadonlySet<string> | 'all'): Promise<void> {
    const next = new Map<string, ResourceState>()
    const paths = [
      ...new Set(candidates.map(c => c.path)),
    ]
    await forEachLimit(paths, ioConcurrency, async (path) => {
      if (reread === 'all' || reread.has(path) || !fileTexts.has(path)) {
        const text = await host.readFile(path)
        if (text === undefined)
          fileTexts.delete(path)
        else
          fileTexts.set(path, text)
      }
    })
    namespaced = config.namespace.separator !== '.' && candidates.some(c => c.namespace !== undefined)
    await Promise.all(candidates.map(candidate => registry.loadFormatFor(candidate.path, candidate.format)))
    for (const candidate of candidates) {
      const text = fileTexts.get(candidate.path)
      if (text === undefined)
        continue
      const id = candidate.block
        ? `${candidate.path}#${candidate.block.index}`
        : candidate.path
      const previous = resourceStates.get(id)
      const content = candidate.block
        ? text.slice(candidate.block.range.start, candidate.block.range.end)
        : text
      if (previous && previous.hash === hashText(content) && previous.resource.locale === candidate.locale && previous.resource.namespace === candidate.namespace && previous.resource.keySeparator === candidate.keySeparator && previous.offset === (candidate.block?.range.start ?? 0))
        next.set(id, previous)
      else
        next.set(id, parseResource(candidate, text))
    }
    resourceStates.clear()
    for (const [id, state] of next)
      resourceStates.set(id, state)

    const found = [
      ...new Set([
        ...resourceStates.values(),
      ].map(state => state.resource.locale)),
    ]
    sourceLocale = config.sourceLocale
    if (!found.includes(sourceLocale) && config.origins.sourceLocale === undefined && found.length > 0)
      sourceLocale = found.find(code => code.toLowerCase().startsWith('en')) ?? [...found].sort()[0]!
    locales = [
      sourceLocale,
      ...found.filter(code => code !== sourceLocale).sort(),
    ]
    if (!found.includes(sourceLocale) && found.length === 0)
      locales = [sourceLocale]
    fallbacks = resolveFallbacks(config.localeFallbacks, locales, sourceLocale)
    resolver = createUsageResolver(config, namespaced, normalizers)
    resolved = new WeakMap()
    resourceIndex = undefined
    // The planner is synchronous: a new file's format has to be loaded before it asks for it.
    const namespaces = new Set([
      undefined,
      ...[
        ...resourceStates.values(),
      ].map(state => state.resource.namespace),
    ])
    await Promise.all([...namespaces].map((namespace) => {
      const path = newResourcePath(sourceLocale, namespace, undefined)
      return path
        ? registry.loadFormatFor(path)
        : undefined
    }))
  }

  // ---- Scanning ----

  async function scanOne(file: SourceFile): Promise<ScanResult> {
    const usages: ScanResult['usages'][number][] = []
    const scopes: NonNullable<ScanResult['scopes']>[number][] = []
    const keySlots: TextRange[] = []
    const hardStrings: HardString[] = []
    const calls = config.usage.calls.filter(spec => ![spec.callee].flat().some(name => config.usage.ignoreCallees.includes(name)))
    for (const scanner of await registry.loadScannersFor(file.path)) {
      const result = await scanner.scan(file, { config, calls })
      usages.push(...result.usages)
      scopes.push(...result.scopes ?? [])
      keySlots.push(...result.keySlots ?? [])
      hardStrings.push(...result.hardStrings ?? [])
    }
    const suppressed = suppressedRanges(file.text)
    const seen = new Set<string>()
    const kept = usages.filter((usage) => {
      const id = `${usage.range.start}:${usage.range.end}`
      if (seen.has(id))
        return false
      seen.add(id)
      return !suppressed.some(range => usage.range.start >= range.start && usage.range.end <= range.end)
    })
    kept.sort((a, b) => a.range.start - b.range.start)
    return {
      usages: kept,
      scopes,
      keySlots,
      hardStrings,
    }
  }

  async function scanPaths(paths: readonly string[]): Promise<void> {
    const pending: SourceFile[] = []
    const cacheKeys = new Map<string, string>()
    await forEachLimit(paths, ioConcurrency, async (path) => {
      const text = await host.readFile(path)
      if (text === undefined) {
        files.delete(path)
        return
      }
      const hash = hashText(text)
      const previous = files.get(path)
      if (previous?.hash === hash)
        return
      if (host.cache) {
        const cacheKey = `scan:${scanSignature}:${path}:${hash}`
        cacheKeys.set(path, cacheKey)
        const cached = await host.cache.get(cacheKey)
        if (cached !== undefined) {
          files.set(path, {
            hash,
            text,
            result: JSON.parse(cached) as ScanResult,
            error: undefined,
          }) // written by this function below
          return
        }
      }
      pending.push({
        path,
        text,
        extension: extensionOf(path),
      })
    })

    const store = (file: SourceFile, result: ScanResult | undefined, error?: X18nError): void => {
      files.set(file.path, {
        hash: hashText(file.text),
        text: file.text,
        result: result ?? { usages: [] },
        error,
      })
      const cacheKey = cacheKeys.get(file.path)
      if (result && cacheKey && host.cache)
        void host.cache.set(cacheKey, JSON.stringify(result))
    }

    await forEachLimit(pending, ioConcurrency, async (file) => {
      try {
        store(file, await scanOne(file))
      }
      catch (error) {
        store(file, undefined, errors.X18N3001({
          path: file.path,
          reason: error instanceof Error
            ? error.message
            : String(error),
          cause: error,
        }))
      }
    })
  }

  async function scanAll(): Promise<void> {
    if (registry.scanners.length === 0)
      return
    const include = pathMatcher(config.usage.include)
    const exclude = pathMatcher(config.usage.exclude)
    usageEligible = path => registry.scannersFor(path).length > 0 && include(path) && !exclude(path)
    const paths = (await host.glob(config.usage.include, { ignore: config.usage.exclude, gitignore: config.usage.gitignore }))
      .filter(path => registry.scannersFor(path).length > 0)
    await scanPaths(paths)
  }

  // ---- Indexes (rebuilt lazily per revision) ----

  interface Index {
    readonly revision: number
    readonly messages: Map<KeyString, Map<LocaleCode, Message[]>>
    readonly keyPaths: Map<KeyString, { namespace: string | undefined, path: string[] }>
    readonly nodes: Map<string, ResourceNode[]>
    readonly parents: Set<KeyString>
    readonly usages: Usage[]
    readonly usagesByKey: Map<KeyString, Usage[]>
    readonly prefixUsages: Usage[]
    readonly derived: Map<KeyString, KeyString[]>
  }
  let index: Index | undefined

  function buildResourceIndex(): ResourceIndex {
    const messages = new Map<KeyString, Map<LocaleCode, Message[]>>()
    const keyPaths = new Map<KeyString, { namespace: string | undefined, path: string[] }>()
    const nodes = new Map<string, ResourceNode[]>()
    const parents = new Set<KeyString>()
    for (const state of resourceStates.values()) {
      const { resource } = state
      const fileNodes = nodes.get(resource.path) ?? []
      nodes.set(resource.path, fileNodes)
      const shift = (range: TextRange): TextRange => ({ start: range.start + state.offset, end: range.end + state.offset })
      const visit = (tree: MessageTree, stored: string[]): void => {
        for (const [segment, child] of Object.entries(tree)) {
          const path = [...stored, segment]
          const key = keyFor(resource, path)
          const storedPath = state.toStored(path)
          const id = pathId(storedPath)
          const raw = state.ranges.get(id)
          const range = raw
            ? {
                key: shift(raw.key),
                value: shift(raw.value),
              }
            : undefined
          if (range) {
            fileNodes.push({
              key,
              range,
              leaf: isMessageLeaf(child),
              locale: resource.locale,
              path: resource.path,
            })
          }
          if (isMessageLeaf(child)) {
            const byLocale = messages.get(key) ?? new Map<LocaleCode, Message[]>()
            messages.set(key, byLocale)
            const list = byLocale.get(resource.locale) ?? []
            byLocale.set(resource.locale, list)
            const description = state.descriptions.get(id)
            const translation = state.states.get(id)
            const label = state.labels.get(id)
            list.push({
              key,
              locale: resource.locale,
              value: child,
              resource: resource.id,
              storedPath,
              range,
              ...description === undefined
                ? {}
                : { description },
              ...translation === undefined
                ? {}
                : { state: translation },
              ...label === undefined
                ? {}
                : { label },
            })
            if (!keyPaths.has(key))
              keyPaths.set(key, keyIdFor(resource, path))
          }
          else {
            parents.add(key)
            visit(child, path)
          }
        }
      }
      visit(state.tree, [])
    }
    // Parent keys of every leaf, so `t('a')` on an object is known.
    for (const { namespace, path } of keyPaths.values()) {
      for (let i = 1; i < path.length; i++)
        parents.add(joinKey(namespace, path.slice(0, i), config.keySeparator))
    }
    const derived = new Map<KeyString, KeyString[]>()
    if (config.usage.derivedKeys.length > 0) {
      for (const key of messages.keys()) {
        for (const base of basesOf(key)) {
          const list = derived.get(base) ?? []
          derived.set(base, list)
          list.push(key)
        }
      }
    }
    return {
      messages,
      keyPaths,
      nodes,
      parents,
      derived,
    }
  }

  function buildIndex(): Index {
    const { messages, parents, derived } = resourceIndex ??= buildResourceIndex()
    const has = (key: KeyString): boolean => messages.has(key) || parents.has(key) || derived.has(key)
    const usages: Usage[] = []
    // Files are read concurrently; sort so results do not depend on I/O timing.
    for (const [path, state] of [...files].sort(([a], [b]) => (a < b
      ? -1
      : a > b
        ? 1
        : 0))) {
      let list = resolved.get(state)
      if (!list) {
        list = state.result.usages.map(candidate => resolver.resolve(candidate, state.result.scopes ?? [], path, 'scanner', has))
        resolved.set(state, list)
      }
      usages.push(...list)
    }
    const usagesByKey = new Map<KeyString, Usage[]>()
    const prefixUsages: Usage[] = []
    for (const usage of usages) {
      if (usage.key === undefined)
        continue
      if (usage.dynamic === 'prefix') {
        prefixUsages.push(usage)
        continue
      }
      const list = usagesByKey.get(usage.key) ?? []
      usagesByKey.set(usage.key, list)
      list.push(usage)
    }
    return {
      revision,
      ...resourceIndex,
      usages,
      usagesByKey,
      prefixUsages,
    }
  }

  function idx(): Index {
    if (!index || index.revision !== revision)
      index = buildIndex()
    return index
  }

  function message(key: KeyString, locale: LocaleCode): Message | undefined {
    return idx().messages.get(key)?.get(locale)?.[0]
  }

  const history = createHistory({
    providers: config.history === false
      ? []
      : [
          ...config.history.providers,
          ...registry.histories,
        ],
    context: (): HistoryContext => ({
      host,
      config,
      resources: [
        ...resourceStates.values(),
      ].map(state => state.resource),
      messagesIn,
    }),
    current: (key, locale) => message(key, locale)?.value,
    onLoad() {
      revision++
      emit({ revision, paths: [], keys: [] })
    },
    logger: host.logger,
  })

  function usageMatches(query: { key?: KeyString | undefined, prefix?: KeyString | undefined, path?: string | undefined } = {}): UsageMatch[] {
    const { usages, usagesByKey, prefixUsages } = idx()
    const inPath = (usage: Usage): boolean => query.path === undefined || usage.path === query.path
    if (query.key !== undefined) {
      const key = query.key
      const direct = [
        key,
        ...basesOf(key),
      ].flatMap(k => usagesByKey.get(k) ?? [])
      return [
        ...direct.filter(inPath).map(usage => ({ usage, possible: false })),
        ...prefixUsages.filter(usage => inPath(usage) && prefixMatches(usage, key)).map(usage => ({ usage, possible: true })),
      ]
    }
    if (query.prefix !== undefined) {
      const prefix = query.prefix
      return [
        ...usages.filter(usage => inPath(usage) && usage.dynamic === false && usage.key !== undefined && isKeyUnder(usage.key, prefix, config.keySeparator)).map(usage => ({ usage, possible: false })),
        ...prefixUsages.filter(usage => inPath(usage) && usage.key !== undefined && (usage.key.startsWith(prefix) || prefix.startsWith(usage.key))).map(usage => ({ usage, possible: true })),
      ]
    }
    return usages.filter(inPath).map(usage => ({ usage, possible: usage.dynamic !== false }))
  }

  const analyzer = createAnalyzer({
    config,
    registry,
    state: () => ({
      revision,
      sourceLocale,
      locales,
      fallbacks,
      resources: [
        ...resourceStates.values(),
      ],
      resourceErrors: [
        ...resourceStates.values(),
      ].flatMap(s => s.error
        ? [
            { error: s.error, path: s.resource.path },
          ]
        : []),
      scanErrors: [...files].flatMap(([path, s]) => s.error
        ? [
            { error: s.error, path },
          ]
        : []),
      discoveryErrors: [
        ...discoveryErrors,
        ...reviewError
          ? [
              { error: reviewError, path: reviewFile },
            ]
          : [],
      ],
      messages: idx().messages,
      parents: idx().parents,
      usages: idx().usages,
      usagesByKey: idx().usagesByKey,
      prefixUsages: idx().prefixUsages,
      derived: idx().derived,
      files,
      history: history.get,
      fresh,
      reviews,
    }),
    basesOf,
    formOf,
    localeInfo,
    text: path => fileTexts.get(path) ?? files.get(path)?.text,
    namespaced: () => namespaced,
  })

  function keys(query: Parameters<Project['keys']>[0] = {}): KeyString[] {
    const { messages, keyPaths } = idx()
    const match = query.glob
      ? keyMatcher([query.glob], config.keySeparator)
      : undefined
    let list = [
      ...messages.keys(),
    ]
    if (match)
      list = list.filter(key => match(key))
    if (query.namespace !== undefined)
      list = list.filter(key => keyPaths.get(key)?.namespace === query.namespace)
    if (query.missing !== undefined) {
      const locale = query.missing
      list = list.filter((key) => {
        const value = message(key, locale)?.value
        return message(key, sourceLocale) !== undefined && (value === undefined || value === '') && needs(key, locale)
      })
    }
    if (query.unused) {
      const unused = new Set(analyzer.analyze().unused)
      list = list.filter(key => unused.has(key))
    }
    return list.sort()
  }

  function search(query: string, options: SearchOptions = {}): SearchMatch[] {
    if (!query)
      return []
    const lower = query.toLowerCase()
    const score = (value: string): number => !options.exact || value.toLowerCase().includes(lower)
      ? fuzzyScore(query, value)
      : -1
    const found: SearchMatch[] = []
    for (const key of idx().messages.keys()) {
      let best: SearchMatch | undefined
      for (const locale of locales) {
        const leaf = message(key, locale)?.value
        if (leaf === undefined || leaf === null)
          continue
        const value = String(leaf)
        const s = score(value)
        if (s >= 0 && (!best || s > best.score))
          best = { key, locale, value, score: s }
      }
      if (best)
        found.push(best)
    }
    return found.sort((a, b) => b.score - a.score || a.value.length - b.value.length || a.key.localeCompare(b.key))
  }

  function get(key: KeyString): KeyInfo | undefined {
    const { messages, keyPaths } = idx()
    const byLocale = messages.get(key)
    if (!byLocale)
      return undefined
    const id = keyPaths.get(key)!
    const list = locales.flatMap(locale => byLocale.get(locale)?.slice(0, 1) ?? [])
    return {
      key,
      namespace: id.namespace,
      path: id.path,
      label: list.find(m => m.label !== undefined)?.label,
      messages: list,
      missing: locales.filter(locale => !byLocale.has(locale) && needs(key, locale)),
      usages: usageMatches({ key }),
      diagnostics: analyzer.analyze().diagnostics.filter(d => d.key === key),
      reviews: reviews({ key }),
    }
  }

  function keyAt(path: string, offset: number): KeyTarget | undefined {
    const fileNodes = idx().nodes.get(path)
    if (fileNodes) {
      let best: ResourceNode | undefined
      for (const node of fileNodes) {
        const hit = rangeContains(node.range.key, offset) || (node.leaf && rangeContains(node.range.value, offset))
        if (hit && (!best || node.range.key.start > best.range.key.start))
          best = node
      }
      if (best) {
        return best.leaf
          ? {
              type: 'key',
              key: best.key,
              range: best.range.key,
              source: 'resource',
            }
          : {
              type: 'subtree',
              key: best.key,
              range: best.range.key,
              source: 'resource',
            }
      }
    }
    const state = files.get(path)
    if (state) {
      const usage = idx().usages.find(u => u.path === path && u.key !== undefined && rangeContains(u.range, offset))
      if (usage?.key !== undefined) {
        return {
          type: 'key',
          key: usage.key,
          range: usage.range,
          source: 'usage',
          usage,
        }
      }
    }
    return undefined
  }

  function explain(): ProjectExplanation {
    const resources = [
      ...resourceStates.values(),
    ]
    return {
      name: config.name,
      root: host.root,
      presets: setup.presets,
      plugins: registry.plugins.map(plugin => plugin.name),
      skipped: setup.skipped,
      finders: finderResults,
      duplicates,
      formats: registry.formats.map(format => ({
        id: format.id,
        extensions: format.extensions,
        resources: resources.filter(state => state.resource.format === format.id).length,
      })),
      scanners: registry.scanners.map(scanner => ({
        id: scanner.id,
        extensions: scanner.extensions,
        files: [
          ...files.keys(),
        ].filter(path => registry.scannersFor(path).includes(scanner)).length,
      })),
      conflicts: registry.conflicts,
      errors: [
        ...discoveryErrors,
        ...reviewError
          ? [
              { error: reviewError, path: reviewFile },
            ]
          : [],
        ...resources.flatMap(state => state.error
          ? [
              { error: state.error, path: state.resource.path },
            ]
          : []),
        ...[...files].flatMap(([path, state]) => state.error
          ? [
              { error: state.error, path },
            ]
          : []),
      ].map(({ error, path }) => ({
        ...toErrorInfo(error),
        path,
      })),
      config,
    }
  }

  function emit(change: ProjectChange): void {
    for (const listener of listeners)
      listener(change)
  }

  function touchedKeys(paths: ReadonlySet<string>, before: Index | undefined): KeyString[] {
    const out = new Set<KeyString>()
    const collect = (from: Index | undefined): void => {
      if (!from)
        return
      for (const path of paths) {
        for (const node of from.nodes.get(path) ?? [])
          out.add(node.key)
      }
      for (const usage of from.usages) {
        if (usage.key !== undefined && paths.has(usage.path))
          out.add(usage.key)
      }
    }
    collect(before)
    collect(idx())
    return [...out]
  }

  /** Reloads the review file and returns the keys whose reviews or records it had or has. */
  async function reloadReviews(): Promise<KeyString[]> {
    const keysOf = (data: ReviewData): string[] => [
      ...Object.keys(data.threads),
      ...Object.keys(data.sources),
    ]
    const old = keysOf(reviewData)
    await loadReviews()
    return [
      ...old,
      ...keysOf(reviewData),
    ]
  }

  let current = Promise.resolve()
  async function update(events: readonly FileEvent[]): Promise<ProjectChange | undefined> {
    const run = current.then(async () => {
      if (events.length === 0)
        return undefined
      const before = idx()
      const paths = new Set(events.map(event => event.path))
      const reviewKeys = paths.has(reviewFile)
        ? await reloadReviews()
        : []
      const resourcePaths = new Set([
        ...resourceStates.values(),
      ].map(state => state.resource.path))
      // An edited source file stays a source file; only other files with a format may have become resources.
      const maybeResource = (path: string): boolean => path !== reviewFile && !resourcePaths.has(path) && registry.formatIdFor(path) !== undefined && !usageEligible(path)
      // Block ranges move when their file changes; only the finders know the new ones.
      const blockPaths = new Set([
        ...resourceStates.values(),
      ].filter(state => state.resource.block).map(state => state.resource.path))
      const structural = events.some(event => event.type !== 'change' || maybeResource(event.path) || blockPaths.has(event.path))
      const touchesResources = structural || [...paths].some(path => resourcePaths.has(path))
      if (touchesResources) {
        const candidates = structural
          ? await discover()
          : [
              ...resourceStates.values(),
            ].map(state => ({
              ...state.resource,
              format: state.resource.format === 'unknown'
                ? undefined
                : state.resource.format,
            }))
        await loadResources(candidates, paths)
      }
      const scanTargets = [...paths].filter(path => usageEligible(path) || files.has(path))
      for (const event of events) {
        if (event.type === 'delete')
          files.delete(event.path)
      }
      await scanPaths(scanTargets.filter(path => events.some(event => event.path === path && event.type !== 'delete')))
      revision++
      const change: ProjectChange = {
        revision,
        paths: [...paths],
        keys: [
          ...new Set([
            ...touchedKeys(paths, before),
            ...reviewKeys,
          ]),
        ],
      }
      emit(change)
      return change
    })
    current = run.then(() => undefined, () => undefined)
    return run
  }

  const planner = createPlanner({
    host,
    config,
    registry,
    state: () => ({
      revision,
      sourceLocale,
      locales,
      fallbacks,
      namespaced,
      resources: [
        ...resourceStates.values(),
      ],
      fileTexts,
      reviews: reviewSource(),
      reviewProblem: reviewProblem(),
    }),
    message: (key, locale) => message(key, locale),
    messages: key => idx().messages.get(key),
    allKeys: () => [
      ...idx().messages.keys(),
    ],
    parents: () => idx().parents,
    usageMatches,
    text: path => fileTexts.get(path) ?? files.get(path)?.text,
    basesOf,
    toStored: (target, path) => storedPathOf(target)(path),
    resolveNew: newResourcePath,
    resolveKey: keyFile,
    update,
  })

  const ready = (async () => {
    const candidates = await discover()
    await Promise.all([
      loadResources(candidates, 'all'),
      loadReviews(),
    ])
    await scanAll()
    revision++
  })()

  const project: Project = {
    get name() {
      return config.name
    },
    config,
    ready,
    get revision() {
      return revision
    },
    get locales() {
      return locales
    },
    get sourceLocale() {
      return sourceLocale
    },
    get resources() {
      return [
        ...resourceStates.values(),
      ].map(state => state.resource)
    },
    get namespaced() {
      return namespaced
    },
    reporters: registry.reporters,
    placeholderSyntaxes: registry.placeholders,
    extractTemplates: [
      ...(config.extract.templates ?? []).map(template => typeof template === 'string'
        ? { template }
        : template),
      ...registry.extractors.flatMap(extractor => extractor.templates),
    ],
    keys,
    search,
    get,
    message,
    parseKey(input) {
      const separator = config.namespace.separator
      if (!namespaced)
        return input
      const index = input.indexOf(':')
      // Without a separator in code a key may hold `:`, so only a known namespace counts as one.
      if (index > 0 && (separator !== false || [
        ...resourceStates.values(),
      ].some(state => state.resource.namespace === input.slice(0, index)))) {
        return input
      }
      if (separator !== ':' && separator !== false) {
        const custom = input.indexOf(separator)
        if (custom > 0)
          return `${input.slice(0, custom)}:${input.slice(custom + separator.length)}`
      }
      return config.namespace.default
        ? `${config.namespace.default}:${input}`
        : input
    },
    usages: usageMatches,
    keyAt,
    nodes: path => idx().nodes.get(path) ?? [],
    locations(key) {
      const order = new Map(locales.map((locale, i) => [locale, i]))
      const all = [
        ...idx().nodes.values(),
      ].flat()
      let found = all.filter(node => node.key === key)
      // A base key used with plural or context suffixes lives in its derived keys.
      if (found.length === 0) {
        const derived = new Set(idx().derived.get(key) ?? [])
        found = all.filter(node => derived.has(node.key))
      }
      return found.sort((a, b) => (order.get(a.locale) ?? 0) - (order.get(b.locale) ?? 0))
    },
    lookup(key, locale) {
      const exact = message(key, locale)
      if (exact)
        return exact
      // The nearest derived key the locale has wins: `item_other` over `item_male_other`.
      const derived = (idx().derived.get(key) ?? [])
        .filter(k => message(k, locale) !== undefined)
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
      const other = derived.find(k => /[._-]other$/.test(k)) ?? derived[0]
      return other === undefined
        ? undefined
        : message(other, locale)
    },
    keySlots: path => files.get(path)?.result.keySlots ?? [],
    hardStrings: path => [...files].sort(([a], [b]) => (a < b
      ? -1
      : a > b
        ? 1
        : 0)).filter(([p]) => path === undefined || p === path).flatMap(([p, state]) => (state.result.hardStrings ?? []).map(h => ({ ...h, path: p }))),
    analyze: (): Analysis => analyzer.analyze(),
    async loadHistory(historyOptions = {}) {
      await ready
      await history.load(historyOptions)
    },
    history: history.get,
    valueAt: history.valueAt,
    reviews,
    reviewFile: reviewStore && reviewFile,
    async reviewAuthor() {
      return config.review.author ?? await host.identity?.()
    },
    prompt: (kind, locale, promptOptions = {}) => buildPrompt(project, kind, locale, promptOptions, {
      config,
      fallbacks,
      hooks: registry.plugins.flatMap(plugin => plugin.translatePrompt
        ? [plugin.translatePrompt]
        : []),
    }),
    explain,
    localeInfo,
    text: path => fileTexts.get(path) ?? files.get(path)?.text ?? (path === reviewFile
      ? reviewText
      : undefined),
    owns: path => fileTexts.has(path) || files.has(path) || usageEligible(path),
    plan: ops => planner.plan(ops),
    planUnused: query => planUnusedDeletion({
      unused: analyzer.analyze().unused,
      usages: idx().usages,
      namespaced,
      ignoreKeys: config.ignoreKeys,
      locations: key => project.locations(key),
      plan: ops => planner.plan(ops),
    }, query),
    planFixes: (diagnostics, query) => planFixes(diagnostics, {
      usages: idx().usages,
      namespaced,
      plan: ops => planner.plan(ops),
    }, query),
    apply: (plan, applyOptions) => planner.apply(plan, applyOptions?.answers ?? {}),
    update,
    watch() {
      if (watcher || !host.watch)
        return
      watcher = host.watch(['**/*'], (events) => {
        void update(events)
      })
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      watcher?.dispose()
      history.dispose()
      listeners.clear()
    },
  }
  return project
}
