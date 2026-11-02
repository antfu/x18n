import type { Builtins, ConfigDraft, Host, Plugin, Project, SerializableConfig, UserConfig } from '@x18n/core'
import type { NodeHost } from './host'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createBuiltins } from '@x18n/builtins'
import { createProject, errors, resolveConfig } from '@x18n/core'
import { glob } from 'tinyglobby'
import { createPluginLoader, findConfigFile, findConfigsBelow, findConfigUpward, loadConfigFile, manifestRootsOf } from './config'
import { gitHistory } from './git-history'
import { createNodeHost, findGitRoot } from './host'
import { readI18nAllyConfig } from './migrate'
import { compileYamlPlugin } from './yaml-plugin'

export interface LoadOptions {
  /** Where to look for a config file (upward). Default: the process cwd. */
  readonly cwd: string
  /** Explicit config file. */
  readonly configFile?: string | undefined
  /** Look for a config in parent directories too. Default true. */
  readonly upward?: boolean | undefined
  /** Only this project of a monorepo. */
  readonly project?: string | undefined
  /** Disable the persistent cache. */
  readonly cache?: boolean | undefined
  readonly builtins?: Builtins | undefined
  readonly logger?: NodeHost['logger']
  /** Wraps each project's host, for example with an overlay of unsaved editor buffers. */
  readonly wrapHost?: ((host: NodeHost) => Host) | undefined
}

export interface LoadedProject {
  readonly name: string
  /** Absolute project root. */
  readonly root: string
  readonly configFile: string | undefined
  readonly host: NodeHost
  readonly project: Project
}

export interface Workspace {
  /** Absolute root of the workspace (the directory of the root config, or the cwd). */
  readonly root: string
  readonly configFile: string | undefined
  readonly projects: readonly LoadedProject[]
}

interface ProjectSpec {
  readonly root: string
  readonly config: UserConfig
  readonly parent: UserConfig | undefined
  readonly configFile: string | undefined
}

/** The nearest directory at or above `cwd`, up to the git root, whose `.vscode/settings.json` has i18n-ally settings. */
function findI18nAllyRoot(cwd: string, upward: boolean): string | undefined {
  let dir = resolve(cwd)
  while (true) {
    const settings = join(dir, '.vscode/settings.json')
    if (existsSync(settings) && /"(?:i18n-ally-next|i18n-ally|vue-i18n-ally)\./.test(readFileSync(settings, 'utf8')))
      return dir
    const parent = dirname(dir)
    if (!upward || parent === dir || existsSync(join(dir, '.git')))
      return undefined
    dir = parent
  }
}

/**
 * Without an x18n config, the project's i18n-ally settings act as defaults, so an i18n-ally project
 * works as it did in the editor. A plugin applies them, so detection and the locale guess still fill gaps.
 */
async function i18nAllyFallback(root: string): Promise<UserConfig | undefined> {
  const found = await readI18nAllyConfig(root)
  if (!found)
    return undefined
  const { presets, plugins: _plugins, ...defaults } = found.config // plugins point at files migrate would write
  const settingsPlugin: Plugin = {
    name: 'x18n:i18n-ally-settings',
    config: draft => applyDefaults(draft, defaults),
  }
  return {
    ...presets
      ? { presets }
      : {},
    plugins: [
      settingsPlugin,
      ...found.plugin
        ? [
            compileYamlPlugin(found.plugin),
          ]
        : [],
    ],
  }
}

function applyDefaults(draft: ConfigDraft, config: SerializableConfig): void {
  if (config.sourceLocale)
    draft.sourceLocale = config.sourceLocale
  if (config.ignoreLocales) {
    draft.ignoreLocales = [
      ...draft.ignoreLocales,
      ...config.ignoreLocales,
    ]
  }
  if (config.localeFallbacks) {
    draft.localeFallbacks = draft.localeFallbacks === 'auto' || config.localeFallbacks === 'auto'
      ? config.localeFallbacks
      : {
          ...draft.localeFallbacks,
          ...config.localeFallbacks,
        }
  }
  if (config.resources) {
    draft.resources = [
      ...draft.resources,
      ...config.resources,
    ]
  }
  if (config.formats) {
    draft.formats = {
      ...draft.formats,
      ...config.formats,
    }
  }
  if (config.keyStyle)
    draft.keyStyle = config.keyStyle
  if (config.namespace?.default)
    draft.namespace = { ...draft.namespace, default: config.namespace.default }
  if (config.usage) {
    draft.usage = {
      ...draft.usage,
      keysInUse: [
        ...draft.usage.keysInUse,
        ...config.usage.keysInUse ?? [],
      ],
      derivedKeys: [
        ...draft.usage.derivedKeys,
        ...config.usage.derivedKeys ?? [],
      ],
      exclude: [
        ...draft.usage.exclude,
        ...config.usage.exclude ?? [],
      ],
    }
  }
  if (config.write) {
    draft.write = {
      sort: config.write.sort ?? draft.write.sort,
      indent: config.write.indent ?? draft.write.indent,
      keepFilled: config.write.keepFilled ?? draft.write.keepFilled,
    }
  }
  if (config.extract) {
    draft.extract = {
      ...draft.extract,
      ...config.extract,
    }
  }
}

async function projectSpecs(rootConfigFile: string | undefined, cwd: string, upward: boolean): Promise<{ root: string, specs: ProjectSpec[] }> {
  if (!rootConfigFile) {
    // A monorepo without a root config: each config below is a workspace of its own, shallowest first,
    // so a config that lists `projects` claims the configs of its projects before they load alone.
    const nested = await findConfigsBelow(cwd)
    if (nested.length) {
      const specs: ProjectSpec[] = []
      for (const file of nested) {
        if (!specs.some(spec => spec.configFile === file))
          specs.push(...(await projectSpecs(file, cwd, false)).specs)
      }
      return {
        root: resolve(cwd),
        specs,
      }
    }
    const settingsRoot = findI18nAllyRoot(cwd, upward)
    const fallback = settingsRoot && await i18nAllyFallback(settingsRoot)
    if (settingsRoot && fallback) {
      return {
        root: settingsRoot,
        specs: [
          {
            root: settingsRoot,
            config: fallback,
            parent: undefined,
            configFile: join(settingsRoot, '.vscode/settings.json'),
          },
        ],
      }
    }
  }
  const configDir = rootConfigFile
    ? dirname(rootConfigFile)
    : resolve(cwd)
  const rootConfig = rootConfigFile
    ? await loadConfigFile(rootConfigFile)
    : {}
  const root = resolve(configDir, rootConfig.root ?? '.')
  if (!rootConfig.projects?.length) {
    return {
      root,
      specs: [
        {
          root,
          config: rootConfig,
          parent: undefined,
          configFile: rootConfigFile,
        },
      ],
    }
  }
  const { projects, ...parent } = rootConfig
  const dirs = await glob([...projects], {
    cwd: root,
    onlyDirectories: true,
    expandDirectories: false,
    ignore: ['**/node_modules/**'],
  })
  const specs: ProjectSpec[] = []
  for (const dir of dirs.sort()) {
    const projectRoot = resolve(root, dir)
    const file = findConfigFile(projectRoot)
    const config = file
      ? await loadConfigFile(file)
      : {}
    specs.push({
      root: resolve(projectRoot, config.root ?? '.'),
      config,
      parent,
      configFile: file,
    })
  }
  return { root, specs }
}

/** Finds the config, resolves every project and waits until each is indexed. */
export async function loadWorkspace(options: LoadOptions): Promise<Workspace> {
  const configFile = options.configFile
    ? resolve(options.cwd, options.configFile)
    : options.upward === false
      ? findConfigFile(resolve(options.cwd))
      : findConfigUpward(options.cwd)
  const { root, specs } = await projectSpecs(configFile, options.cwd, options.upward !== false)
  const gitRoot = findGitRoot(root)
  const defaults = options.builtins ?? await createBuiltins()
  const builtins = gitRoot
    ? {
        ...defaults,
        plugins: [
          ...defaults.plugins,
          gitHistory(),
        ],
      }
    : defaults
  const loaded: LoadedProject[] = []
  const names: string[] = []
  for (const spec of specs) {
    const name = spec.config.name ?? (spec.root === root
      ? relative(dirname(root), root)
      : relative(root, spec.root)).replace(/\\/g, '/')
    names.push(name)
    if (options.project !== undefined && options.project !== name)
      continue
    const host = createNodeHost(spec.root, {
      cacheDir: options.cache === false
        ? false
        : undefined,
      logger: options.logger,
    })
    const projectHost = options.wrapHost?.(host) ?? host
    const setup = await resolveConfig({
      host: projectHost,
      config: spec.config,
      parent: spec.parent,
      builtins,
      name,
      runtime: 'node',
      loadPlugin: createPluginLoader(spec.configFile
        ? dirname(spec.configFile)
        : spec.root),
      manifestRoots: await manifestRootsOf(spec.root, gitRoot),
    })
    const project = createProject({ host: projectHost, setup })
    await project.ready
    await host.flush()
    loaded.push({
      name,
      root: spec.root,
      configFile: spec.configFile,
      host,
      project,
    })
  }
  if (options.project !== undefined && loaded.length === 0)
    throw errors.X18N0003({ name: options.project, available: names })
  return { root, configFile, projects: loaded }
}
