import type { PluginConfigs, UserConfig } from './types/config'
import type { Plugin, Preset } from './types/plugin'
import type { Translator } from './types/translate'

export function definePlugin<const T extends Plugin>(plugin: T): T
export function definePlugin<O, const T extends Plugin>(factory: (options: O) => T): (options: O) => T
export function definePlugin<T>(plugin: T): T {
  return plugin
}

export function definePreset<const T extends Preset>(preset: T): T {
  return preset
}

export function defineTranslator<const T extends Translator>(translator: T): T {
  return translator
}

export function defineConfig(config: UserConfig & { readonly [K in keyof PluginConfigs]?: PluginConfigs[K] }): UserConfig {
  return config
}
