import type { PluginRegistry } from './plugins'
import type { ConfigDraft, ConfigOrigin, PluginOption, PresetOption, ResolvedConfig, SerializableConfig, UserConfig } from './types/config'
import type { Host } from './types/host'
import type { JsonObject } from './types/model'
import type { ConfigContext, DetectContext, ManifestReader, Plugin, Preset, PresetEntry } from './types/plugin'
import { errors } from './errors'
import { createRegistry, isPreset } from './plugins'
import { ConfigSchema, validate } from './schema'

/** Plugins that are always on, and presets that `'auto'` and names refer to. Passed in by the caller. */
export interface Builtins {
  readonly plugins: readonly Plugin[]
  readonly presets: { readonly [name: string]: PresetEntry }
}

export interface ResolveConfigOptions {
  readonly host: Host
  readonly config: UserConfig
  /** Root config of a monorepo, inherited by this project. */
  readonly parent?: UserConfig | undefined
  readonly builtins: Builtins
  /** Default project name. */
  readonly name?: string | undefined
  /** Loads string plugin specifiers. Without it, string plugins are a config error. */
  readonly loadPlugin?: ((specifier: string, options: JsonObject | undefined) => Promise<Plugin | Preset>) | undefined
  readonly runtime?: 'node' | 'browser' | undefined
  /** Extra directories (relative to the host root) whose manifests count for detection, such as the workspace root. */
  readonly manifestRoots?: readonly string[] | undefined
}

export interface PresetExplanation {
  readonly name: string
  readonly reason: 'listed' | 'detected' | 'not-detected' | 'after-exclusive'
}

export interface Setup {
  readonly config: ResolvedConfig
  readonly registry: PluginRegistry
  readonly presets: readonly PresetExplanation[]
  /** Plugins skipped because they cannot run in this runtime. */
  readonly skipped: readonly { readonly name: string, readonly reason: string }[]
}

const defaultExclude = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.nuxt/**',
  '**/.output/**',
  '**/.next/**',
  '**/.svelte-kit/**',
  '**/*.d.ts',
  '**/*.min.js',
]

function defaultDraft(): ConfigDraft {
  return {
    sourceLocale: 'en',
    locales: undefined,
    ignoreLocales: [],
    localeFallbacks: {},
    resources: [],
    formats: {},
    keyStyle: 'auto',
    keySeparator: '.',
    namespace: {
      separator: '.',
      default: undefined,
      fallback: [],
      byFile: {},
      fromPath: 'dot',
    },
    usage: {
      include: ['**/*'],
      exclude: defaultExclude,
      calls: [],
      regex: [],
      ignoreCallees: [],
      keysInUse: [],
      derivedKeys: [],
    },
    write: { sort: false, indent: undefined, keepFilled: false },
    extract: {},
    checks: {},
    strict: false,
    ignoreKeys: [],
    glossary: [],
    history: { providers: [] },
    review: {
      enabled: true,
      file: '.x18n/reviews.yml',
      author: undefined,
    },
    pluginConfigs: {},
  }
}

function serializablePart(config: UserConfig): SerializableConfig {
  const { presets, plugins, pluginConfigs, history, ...rest } = config
  if (typeof history !== 'object')
    return { ...rest, history }
  const { providers, ...options } = history
  return { ...rest, history: options }
}

function mergeFallbacks(base: ResolvedConfig['localeFallbacks'], layer: ResolvedConfig['localeFallbacks']): ResolvedConfig['localeFallbacks'] {
  return base === 'auto' || layer === 'auto'
    ? layer
    : {
        ...base,
        ...layer,
      }
}

/** Applies a user config layer: scalars replace, lists of rules append. */
function applyLayer(draft: ConfigDraft, layer: UserConfig, origin: ConfigOrigin, origins: Record<string, ConfigOrigin>): void {
  const mark = (key: string): void => {
    origins[key] = origin
  }
  if (layer.sourceLocale !== undefined) {
    draft.sourceLocale = layer.sourceLocale
    mark('sourceLocale')
  }
  if (layer.locales !== undefined) {
    draft.locales = layer.locales
    mark('locales')
  }
  if (layer.ignoreLocales !== undefined) {
    draft.ignoreLocales = [
      ...draft.ignoreLocales,
      ...layer.ignoreLocales,
    ]
    mark('ignoreLocales')
  }
  if (layer.localeFallbacks !== undefined) {
    draft.localeFallbacks = mergeFallbacks(draft.localeFallbacks, layer.localeFallbacks)
    mark('localeFallbacks')
  }
  if (layer.resources !== undefined) {
    draft.resources = layer.resources
    mark('resources')
  }
  if (layer.formats !== undefined) {
    draft.formats = {
      ...draft.formats,
      ...layer.formats,
    }
    mark('formats')
  }
  if (layer.keyStyle !== undefined) {
    draft.keyStyle = layer.keyStyle
    mark('keyStyle')
  }
  if (layer.keySeparator !== undefined) {
    draft.keySeparator = layer.keySeparator
    mark('keySeparator')
  }
  if (layer.namespace !== undefined) {
    draft.namespace = {
      separator: layer.namespace.separator ?? draft.namespace.separator,
      default: layer.namespace.default ?? draft.namespace.default,
      fallback: layer.namespace.fallback ?? draft.namespace.fallback,
      byFile: {
        ...draft.namespace.byFile,
        ...layer.namespace.byFile,
      },
      fromPath: layer.namespace.fromPath ?? draft.namespace.fromPath,
    }
    mark('namespace')
  }
  const usage = layer.usage
  if (usage !== undefined) {
    draft.usage = {
      include: usage.include ?? draft.usage.include,
      exclude: [
        ...draft.usage.exclude,
        ...usage.exclude ?? [],
      ],
      calls: [
        ...draft.usage.calls,
        ...usage.calls ?? [],
      ],
      regex: [
        ...draft.usage.regex,
        ...usage.regex ?? [],
      ],
      ignoreCallees: [
        ...draft.usage.ignoreCallees,
        ...usage.ignoreCallees ?? [],
      ],
      keysInUse: [
        ...draft.usage.keysInUse,
        ...usage.keysInUse ?? [],
      ],
      derivedKeys: [
        ...draft.usage.derivedKeys,
        ...usage.derivedKeys ?? [],
      ],
    }
    mark('usage')
  }
  if (layer.write !== undefined) {
    draft.write = {
      sort: layer.write.sort ?? draft.write.sort,
      indent: layer.write.indent ?? draft.write.indent,
      keepFilled: layer.write.keepFilled ?? draft.write.keepFilled,
    }
    mark('write')
  }
  if (layer.extract !== undefined) {
    draft.extract = {
      ...draft.extract,
      ...layer.extract,
      templates: [
        ...draft.extract.templates ?? [],
        ...layer.extract.templates ?? [],
      ],
    }
    mark('extract')
  }
  if (layer.checks !== undefined) {
    draft.checks = {
      ...draft.checks,
      ...layer.checks,
    }
    mark('checks')
  }
  if (layer.strict !== undefined) {
    draft.strict = layer.strict
    mark('strict')
  }
  if (layer.ignoreKeys !== undefined) {
    draft.ignoreKeys = [
      ...draft.ignoreKeys,
      ...layer.ignoreKeys,
    ]
    mark('ignoreKeys')
  }
  if (layer.glossary !== undefined) {
    draft.glossary = [
      ...draft.glossary,
      ...layer.glossary,
    ]
    mark('glossary')
  }
  if (layer.history !== undefined) {
    const previous = draft.history || { providers: [] }
    draft.history = layer.history === false
      ? false
      : layer.history === true
        ? previous
        : {
            ...previous,
            ...layer.history,
            providers: [
              ...previous.providers,
              ...layer.history.providers ?? [],
            ],
          }
    mark('history')
  }
  if (layer.review !== undefined) {
    draft.review = {
      enabled: layer.review.enabled ?? draft.review.enabled,
      file: layer.review.file ?? draft.review.file,
      author: layer.review.author ?? draft.review.author,
    }
    mark('review')
  }
  if (layer.pluginConfigs !== undefined) {
    draft.pluginConfigs = {
      ...draft.pluginConfigs,
      ...layer.pluginConfigs,
    }
    mark('pluginConfigs')
  }
}

async function createDetectContext(host: Host, readers: readonly ManifestReader[], roots: readonly string[]): Promise<DetectContext> {
  const dependencies = new Set<string>()
  const seen = new Set<string>()
  for (const root of ['', ...roots]) {
    for (const reader of readers) {
      const path = root
        ? `${root.replace(/\/$/, '')}/${reader.file}`
        : reader.file
      if (seen.has(path))
        continue
      seen.add(path)
      const text = await host.readFile(path)
      if (text === undefined)
        continue
      try {
        for (const name of reader.read(text))
          dependencies.add(name)
      }
      catch {
        host.logger?.warn(`Could not read manifest ${path}`)
      }
    }
  }
  return {
    host,
    dependencies,
    hasDependency: name => dependencies.has(name),
    hasAnyDependency: names => names.some(name => dependencies.has(name)),
    fileExists: async pattern => (await host.glob([pattern], { gitignore: true })).length > 0,
  }
}

type Loaded = Plugin | Preset

function validateLayers(layers: readonly (UserConfig | undefined)[]): void {
  for (const layer of layers) {
    if (!layer)
      continue
    const result = validate(ConfigSchema, serializablePart(layer))
    if (!result.success) {
      throw errors.X18N0001({
        issue: result.issues.map(issue => `${issue.path || '(root)'}: ${issue.message}`).join('; '),
      })
    }
  }
}

function createLoader(options: ResolveConfigOptions): (option: PresetOption | PluginOption) => Promise<Loaded | undefined> {
  return async (option) => {
    if (option === false || option === undefined)
      return undefined
    if (typeof option === 'object' && !Array.isArray(option))
      return option as Loaded // the only object members of the option unions are plugins and presets
    const [specifier, pluginOptions] = typeof option === 'string'
      ? [option, undefined]
      : [option[0], option[1]]
    const entry = options.builtins.presets[specifier]
    if (entry)
      return (await entry.load()).default(pluginOptions)
    if (!options.loadPlugin)
      throw errors.X18N1003({ preset: specifier })
    return options.loadPlugin(specifier, pluginOptions)
  }
}

async function loadAll(load: (option: PresetOption | PluginOption) => Promise<Loaded | undefined>, list: readonly (PresetOption | PluginOption)[]): Promise<Loaded[]> {
  const out: Loaded[] = []
  for (const option of list) {
    const loaded = await load(option)
    if (loaded)
      out.push(loaded)
  }
  return out
}

/** A built-in preset that is not loaded yet: only its `detect` has run. */
interface LazyPreset {
  readonly name: string
  readonly entry: PresetEntry
}

/** Expands presets depth-first: listed presets always apply, others only when detected; an exclusive one stops the rest. */
async function expandPresets(presets: readonly (Preset | LazyPreset)[], userPlugins: readonly Loaded[], listed: boolean, detectCtx: DetectContext): Promise<{ plugins: Plugin[], explanations: PresetExplanation[] }> {
  const explanations: PresetExplanation[] = []
  const plugins: Plugin[] = []
  const flatten = async (item: Loaded, force: boolean): Promise<boolean> => {
    if (!isPreset(item)) {
      // Presets often share plugins (nuxt-i18n includes vue-i18n); names are unique, so the first one stays.
      if (!plugins.some(plugin => plugin.name === item.name))
        plugins.push(item)
      return false
    }
    const applies = force || (item.detect
      ? await item.detect(detectCtx)
      : false)
    explanations.push({
      name: item.name,
      reason: applies
        ? (force ? 'listed' : 'detected')
        : 'not-detected',
    })
    if (!applies)
      return false
    for (const child of item.plugins)
      await flatten(child, false)
    return item.exclusive === true
  }
  let stopped = false
  for (const preset of presets) {
    if (stopped) {
      explanations.push({ name: preset.name, reason: 'after-exclusive' })
    }
    else if ('entry' in preset) {
      const applies = listed || (preset.entry.detect
        ? await preset.entry.detect(detectCtx)
        : false)
      explanations.push({
        name: preset.name,
        reason: applies
          ? (listed ? 'listed' : 'detected')
          : 'not-detected',
      })
      if (!applies)
        continue
      const loaded = (await preset.entry.load()).default()
      for (const child of loaded.plugins)
        await flatten(child, false)
      stopped = preset.entry.exclusive === true || loaded.exclusive === true
    }
    else {
      stopped = await flatten(preset, listed)
    }
  }
  for (const plugin of userPlugins)
    await flatten(plugin, true)
  return { plugins, explanations }
}

async function runConfigHooks(plugins: readonly Plugin[], draft: ConfigDraft, ctx: ConfigContext, origins: Record<string, ConfigOrigin>): Promise<void> {
  for (const plugin of plugins) {
    if (!plugin.config)
      continue
    const snapshot = Object.fromEntries(Object.entries(draft).map(([key, value]) => [
      key,
      JSON.stringify(value),
    ]))
    await plugin.config(draft, ctx)
    for (const [key, value] of Object.entries(draft)) {
      if (snapshot[key] !== JSON.stringify(value))
        origins[key] = `plugin:${plugin.name}`
    }
  }
}

export async function resolveConfig(options: ResolveConfigOptions): Promise<Setup> {
  const { host, builtins } = options
  const user = options.config
  validateLayers([options.parent, user])

  const load = createLoader(options)
  const userPlugins = await loadAll(load, [
    ...options.parent?.plugins ?? [],
    ...user.plugins ?? [],
  ])
  const presetOption = user.presets ?? options.parent?.presets ?? 'auto'
  const auto = presetOption === 'auto'
  const presets = auto
    ? Object.entries(builtins.presets).map(([name, entry]): LazyPreset => ({ name, entry }))
    : (await loadAll(load, presetOption)).map(item => isPreset(item)
        ? item
        : {
            name: item.name,
            plugins: [item],
          })

  const readers = [
    ...builtins.plugins,
    ...userPlugins,
  ].flatMap(item => isPreset(item)
    ? []
    : item.manifests ?? [])
  const detectCtx = await createDetectContext(host, readers, options.manifestRoots ?? [])
  const expanded = await expandPresets(presets, userPlugins, !auto, detectCtx)

  const skipped: { name: string, reason: string }[] = []
  const finalPlugins = [
    ...builtins.plugins,
    ...expanded.plugins,
  ].filter((plugin) => {
    const skip = options.runtime === 'browser' && plugin.runtime === 'node'
    if (skip)
      skipped.push({ name: plugin.name, reason: 'node only' })
    return !skip
  })

  const draft = defaultDraft()
  const origins: Record<string, ConfigOrigin> = {}
  await runConfigHooks(finalPlugins, draft, {
    host,
    user: serializablePart(user),
  }, origins)
  if (options.parent)
    applyLayer(draft, options.parent, 'parent', origins)
  applyLayer(draft, user, 'user', origins)

  const config: ResolvedConfig = Object.freeze({
    ...draft,
    name: user.name ?? options.name ?? 'default',
    usage: {
      ...draft.usage,
      derivedKeys: [
        ...draft.usage.derivedKeys,
        ...finalPlugins.flatMap(plugin => plugin.derivedKeys ?? []),
      ],
    },
    origins,
  })
  for (const plugin of finalPlugins)
    plugin.configResolved?.(config)

  return {
    config,
    registry: createRegistry(finalPlugins, config),
    presets: expanded.explanations,
    skipped,
  }
}
