import type { ResolvedConfig } from './types/config'
import type {
  Check,
  Extractor,
  Format,
  HistoryProvider,
  LazyFormat,
  LazyScanner,
  LocaleFinder,
  ManifestReader,
  MessageSyntax,
  PlaceholderSyntax,
  Plugin,
  Preset,
  Reporter,
  Scanner,
} from './types/plugin'
import type { ReviewStore } from './types/review'
import type { Translator } from './types/translate'
import { errors } from './errors'

export function isPreset(value: Plugin | Preset): value is Preset {
  return 'plugins' in value && Array.isArray(value.plugins)
}

export interface CapabilityConflict {
  readonly capability: 'format' | 'scanner'
  readonly extension: string
  readonly winner: string
  readonly loser: string
}

/** The capabilities of the final plugin list, indexed for the project engine. */
export interface PluginRegistry {
  readonly plugins: readonly Plugin[]
  /** Every format, loaded or not; use `formatFor` and `loadFormatFor` to run one. */
  readonly formats: readonly (Format | LazyFormat)[]
  readonly finders: readonly LocaleFinder[]
  /** Every scanner, loaded or not. */
  readonly scanners: readonly (Scanner | LazyScanner)[]
  readonly checks: ReadonlyMap<string, Check>
  readonly reporters: ReadonlyMap<string, Reporter>
  readonly placeholders: readonly PlaceholderSyntax[]
  /** Merged from every plugin: the literals of all of them, and every reserved character. */
  readonly messageSyntax: MessageSyntax
  readonly manifests: readonly ManifestReader[]
  readonly extractors: readonly Extractor[]
  readonly histories: readonly HistoryProvider[]
  readonly reviewStores: readonly ReviewStore[]
  /** By id, in plugin order. */
  readonly translators: ReadonlyMap<string, Translator>
  readonly conflicts: readonly CapabilityConflict[]
  /** The loaded format for a file path: config `formats` first, then the first format that claims the extension. */
  readonly formatFor: (path: string, hint?: string) => Format | undefined
  /** The id of the format `formatFor` would pick, loaded or not. */
  readonly formatIdFor: (path: string, hint?: string) => string | undefined
  /** The loaded format with this id. */
  readonly formatById: (id: string) => Format | undefined
  /** Loads the format of a file path, once, and returns it. */
  readonly loadFormatFor: (path: string, hint?: string) => Promise<Format | undefined>
  /** The scanners that handle a file path, loaded or not. */
  readonly scannersFor: (path: string) => readonly (Scanner | LazyScanner)[]
  /** Loads the scanners of a file path, once each, and returns them. */
  readonly loadScannersFor: (path: string) => Promise<readonly Scanner[]>
}

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0
    ? ''
    : base.slice(dot + 1).toLowerCase()
}

function sortByEnforce(plugins: readonly Plugin[]): Plugin[] {
  const rank = (plugin: Plugin): number => plugin.enforce === 'pre'
    ? 0
    : plugin.enforce === 'post'
      ? 2
      : 1
  return [...plugins].sort((a, b) => rank(a) - rank(b))
}

function uniqueById<T extends { readonly id: string, readonly override?: boolean | undefined }>(items: readonly T[], kind: string): Map<string, T> {
  const out = new Map<string, T>()
  for (const item of items) {
    if (out.has(item.id) && !item.override)
      throw errors.X18N1002({ kind, id: item.id })
    out.set(item.id, item)
  }
  return out
}

export function createRegistry(input: readonly Plugin[], config: Pick<ResolvedConfig, 'formats'>): PluginRegistry {
  const plugins = sortByEnforce(input)
  const formats = plugins.flatMap(plugin => [
    ...plugin.formats ?? [],
    ...plugin.lazyFormats ?? [],
  ])
  // Lazy scanners load once per id, so one that several plugins list (the presets of one framework) runs once.
  const lazyIds = new Set<string>()
  const scanners = plugins.flatMap(plugin => [
    ...plugin.scanners ?? [],
    ...(plugin.lazyScanners ?? []).filter(entry => !lazyIds.has(entry.id) && lazyIds.add(entry.id)),
  ])
  const finders = [
    ...uniqueById(plugins.flatMap(plugin => plugin.localeFinders ?? []), 'Locale finder').values(),
  ]
  const checks = uniqueById(plugins.flatMap(plugin => plugin.checks ?? []), 'Check')
  const reporters = uniqueById(plugins.flatMap(plugin => plugin.reporters ?? []), 'Reporter')
  const translators = uniqueById(plugins.flatMap(plugin => plugin.translators ?? []), 'Translator')
  const conflicts: CapabilityConflict[] = []

  const byExtension = new Map<string, Format | LazyFormat>()
  for (const format of formats) {
    for (const extension of format.extensions) {
      const winner = byExtension.get(extension)
      if (winner) {
        conflicts.push({
          capability: 'format',
          extension,
          winner: winner.id,
          loser: format.id,
        })
      }
      else {
        byExtension.set(extension, format)
      }
    }
  }
  const isLazy = (format: Format | LazyFormat): format is LazyFormat => 'load' in format
  const loaded = new Map<string, Format>(formats.filter((format): format is Format => !isLazy(format)).map(format => [format.id, format]))
  const loading = new Map<string, Promise<Format | undefined>>()
  const formatById = (id: string): Format | undefined => loaded.get(id)
  const formatIdFor = (path: string, hint?: string): string | undefined => {
    if (hint)
      return hint
    const extension = extensionOf(path)
    return config.formats[extension] ?? byExtension.get(extension)?.id
  }
  const loadFormat = (id: string): Promise<Format | undefined> => {
    const ready = loaded.get(id)
    if (ready)
      return Promise.resolve(ready)
    const lazy = formats.find(format => format.id === id)
    if (!lazy || !isLazy(lazy))
      return Promise.resolve(undefined)
    let pending = loading.get(id)
    if (!pending) {
      pending = lazy.load().then((mod) => {
        const format = mod.default().formats?.find((item): item is Format => item.id === id && !isLazy(item))
        if (format)
          loaded.set(id, format)
        return format
      })
      loading.set(id, pending)
    }
    return pending
  }

  const scannerCache = new Map<string, (Scanner | LazyScanner)[]>()
  const loadedScanners = new Map<string, Scanner>(scanners.filter((scanner): scanner is Scanner => !('load' in scanner)).map(scanner => [scanner.id, scanner]))
  const loadingScanners = new Map<string, Promise<Scanner | undefined>>()
  const loadScanner = (entry: Scanner | LazyScanner): Promise<Scanner | undefined> => {
    if (!('load' in entry))
      return Promise.resolve(entry)
    const ready = loadedScanners.get(entry.id)
    if (ready)
      return Promise.resolve(ready)
    let pending = loadingScanners.get(entry.id)
    if (!pending) {
      pending = entry.load().then((mod) => {
        const scanner = mod.default().scanners?.find(item => item.id === entry.id)
        if (scanner)
          loadedScanners.set(entry.id, scanner)
        return scanner
      })
      loadingScanners.set(entry.id, pending)
    }
    return pending
  }

  const scannersFor = (path: string): readonly (Scanner | LazyScanner)[] => {
    const extension = extensionOf(path)
    let list = scannerCache.get(extension)
    if (!list) {
      list = extension
        ? scanners.filter(scanner => scanner.extensions.includes(extension) || scanner.extensions.includes('*'))
        : []
      scannerCache.set(extension, list)
    }
    return list
  }

  return {
    plugins,
    formats,
    finders,
    scanners,
    checks,
    reporters,
    placeholders: plugins.flatMap(plugin => plugin.placeholders ?? []),
    messageSyntax: {
      literals: plugins.flatMap(plugin => plugin.messageSyntax?.literals ?? []),
      reserved: [
        ...new Set(plugins.flatMap(plugin => [
          ...plugin.messageSyntax?.reserved ?? '',
        ])),
      ].join(''),
    },
    manifests: plugins.flatMap(plugin => plugin.manifests ?? []),
    extractors: plugins.flatMap(plugin => plugin.extractors ?? []),
    histories: plugins.flatMap(plugin => plugin.histories ?? []),
    reviewStores: plugins.flatMap(plugin => plugin.reviewStores ?? []),
    translators,
    conflicts,
    formatById,
    formatIdFor,
    formatFor(path, hint) {
      const id = formatIdFor(path, hint)
      return id === undefined
        ? undefined
        : formatById(id)
    },
    async loadFormatFor(path, hint) {
      const id = formatIdFor(path, hint)
      return id === undefined
        ? undefined
        : loadFormat(id)
    },
    scannersFor,
    async loadScannersFor(path) {
      const loaded = await Promise.all(scannersFor(path).map(loadScanner))
      return loaded.filter((scanner): scanner is Scanner => scanner !== undefined)
    },
  }
}
