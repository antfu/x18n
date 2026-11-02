import type { LocaleInfo, Plugin, PluginFile, Preset } from '@x18n/core'
import { placeholderFromShape } from '@x18n/builtins/placeholders'
import regexScopes from '@x18n/builtins/scanners/regex-scopes'

/**
 * Compiles a validated YAML plugin into plugin objects. Each section maps to the
 * options of a built-in factory, so moving to a TS plugin is a small change.
 */
export function compileYamlPlugin(data: PluginFile): Plugin | Preset {
  const replacements = (data.normalizeKey ?? []).map(rule => ({
    from: new RegExp(rule.replace.pattern, 'g'),
    to: rule.replace.with,
  }))
  const localeInfo = data.localeInfo
  const plugin: Plugin = {
    name: data.name,
    config(draft) {
      const defaults = data.config
      if (defaults?.sourceLocale)
        draft.sourceLocale = defaults.sourceLocale
      if (defaults?.locales)
        draft.locales = defaults.locales
      if (defaults?.resources && draft.resources.length === 0)
        draft.resources = defaults.resources
      if (defaults?.keyStyle)
        draft.keyStyle = defaults.keyStyle
      if (defaults?.keySeparator !== undefined)
        draft.keySeparator = defaults.keySeparator
      if (defaults?.namespace) {
        draft.namespace = {
          separator: defaults.namespace.separator ?? draft.namespace.separator,
          default: defaults.namespace.default ?? draft.namespace.default,
          fallback: defaults.namespace.fallback ?? draft.namespace.fallback,
          byFile: {
            ...draft.namespace.byFile,
            ...defaults.namespace.byFile,
          },
          fromPath: defaults.namespace.fromPath ?? draft.namespace.fromPath,
        }
      }
      draft.usage = {
        ...draft.usage,
        calls: [
          ...draft.usage.calls,
          ...data.scanners?.calls ?? [],
        ],
        regex: [
          ...draft.usage.regex,
          ...data.scanners?.regex ?? [],
        ],
      }
      if (data.extract?.templates) {
        draft.extract = {
          ...draft.extract,
          templates: [
            ...draft.extract.templates ?? [],
            ...data.extract.templates,
          ],
        }
      }
    },
    derivedKeys: data.derivedKeys,
    placeholders: data.placeholders?.map(placeholderFromShape),
    normalizeKey: replacements.length > 0
      ? raw => replacements.reduce((text, rule) => text.replace(rule.from, rule.to), raw)
      : undefined,
    localeInfo: localeInfo
      ? (code): Partial<LocaleInfo> | undefined => {
          const info = localeInfo[code]
          return info
            ? {
                ...info.flag
                  ? { flag: info.flag }
                  : {},
                ...info.displayName
                  ? { displayName: info.displayName }
                  : {},
              }
            : undefined
        }
      : undefined,
  }
  const plugins: Plugin[] = [
    plugin,
    ...data.scopes
      ? [
          regexScopes(data.scopes.regex, `${data.name}-scopes`),
        ]
      : [],
  ]
  const detect = data.detect
  if (!detect) {
    return plugins.length === 1
      ? plugin
      : { name: data.name, plugins }
  }
  return {
    name: data.name,
    exclusive: data.exclusive,
    plugins,
    async detect(ctx) {
      const deps = detect.dependencies
      if (deps?.any && !ctx.hasAnyDependency(deps.any))
        return false
      if (deps?.all && !deps.all.every(ctx.hasDependency))
        return false
      for (const pattern of detect.files ?? []) {
        if (!await ctx.fileExists(pattern))
          return false
      }
      return true
    },
  }
}
