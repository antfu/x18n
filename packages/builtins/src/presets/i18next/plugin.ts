import type { CallSpec, ConfigContext, KeySeparator, Plugin } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
import { doubleBraces, nesting } from '../../placeholders'

interface InitOptions {
  default: string | undefined
  fallback: string[] | undefined
  keySeparator: KeySeparator | undefined
  nsSeparator: KeySeparator | undefined
}

/** A `keySeparator` or `nsSeparator` option: `false` or a string. */
function separatorOption(text: string, name: string): KeySeparator | undefined {
  const found = new RegExp(`\\b${name}\\s*:\\s*(?:(false)\\b|['"\`]([^'"\`]+)['"\`])`).exec(text)
  if (!found)
    return undefined
  return found[1]
    ? false
    : found[2]
}

/**
 * `defaultNS`, `fallbackNS`, `keySeparator` and `nsSeparator` from the i18next init code (`i18n.ts`, `next-i18next.config.js`),
 * as keys without a namespace use them and literal keys need no separator.
 */
async function findInitOptions(host: ConfigContext['host']): Promise<InitOptions> {
  const files = await host.glob(['**/*i18n*.{js,mjs,cjs,ts,mts,cts}', '**/i18n/index.{js,ts}'], {
    ignore: ['**/node_modules/**', '**/dist/**'],
    gitignore: true,
  })
  const found: InitOptions = {
    default: undefined,
    fallback: undefined,
    keySeparator: undefined,
    nsSeparator: undefined,
  }
  for (const file of files.slice(0, 20)) {
    const text = await host.readFile(file) ?? ''
    found.default ??= /\bdefaultNS\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1]
    const fallback = /\bfallbackNS\s*:\s*(\[[^\]]*\]|['"`][^'"`]+['"`])/.exec(text)?.[1]
    found.fallback ??= fallback
      ? [
          ...fallback.matchAll(/['"`]([^'"`]+)['"`]/g),
        ].map(m => m[1]!)
      : undefined
    found.keySeparator ??= separatorOption(text, 'keySeparator')
    found.nsSeparator ??= separatorOption(text, 'nsSeparator')
  }
  return found
}

/** Params and default value of a translate function: `t(key, 'Default', { name })`, `t(key, { name, defaultValue })`. */
export const i18nextArgs: Pick<CallSpec, 'params' | 'defaultValue'> = {
  params: {
    arg: [1, 2],
    // The options i18next reads itself, after i18next-cli (MIT), src/linter.ts.
    options: [
      'defaultValue',
      'count',
      'context',
      'ns',
      'lng',
      'lngs',
      'fallbackLng',
      'returnDetails',
      'returnObjects',
      'joinArrays',
      'postProcess',
      'interpolation',
      'skipInterpolation',
      'replace',
      'ordinal',
      'keySeparator',
      'nsSeparator',
      'tDescription',
    ],
  },
  defaultValue: [
    { arg: 1 },
    { arg: 1, property: 'defaultValue' },
  ],
}

export const i18nextPlugin: Plugin = createLibraryPlugin({
  name: 'x18n:i18next',
  // i18next names a namespace in a folder by its path: `useTranslation('pages/home')`.
  namespace: { separator: ':', default: 'translation', fromPath: 'slash' },
  extra: async (draft, ctx) => {
    const user = ctx.user.namespace
    if (user?.default && user.fallback && ctx.user.keySeparator !== undefined && user.separator !== undefined)
      return
    const found = await findInitOptions(ctx.host)
    if (ctx.user.keySeparator === undefined && found.keySeparator !== undefined)
      draft.keySeparator = found.keySeparator
    draft.namespace = {
      ...draft.namespace,
      separator: user?.separator ?? found.nsSeparator ?? draft.namespace.separator,
      default: user?.default ?? found.default ?? draft.namespace.default,
      fallback: user?.fallback ?? found.fallback ?? draft.namespace.fallback,
    }
  },
  calls: [
    {
      callee: ['t', 'i18next.t', 'i18n.t'],
      namespace: { arg: 1, property: 'ns' },
      ...i18nextArgs,
    },
    {
      callee: ['getFixedT', 'i18next.getFixedT', 'i18n.getFixedT'],
      factory: true,
      returns: ['t'],
      namespace: { arg: 1 },
      keyPrefix: { arg: 2 },
      ...i18nextArgs,
    },
    {
      callee: 'tr',
      types: ['TFunction'],
      ...i18nextArgs,
    },
  ],
  // Plural forms first, so each locale needs its own categories; `*` covers contexts and the v3 `_plural`.
  placeholders: [doubleBraces, nesting],
  derivedKeys: ['{key}_ordinal_{ordinal}', '{key}_{plural}', '{key}_*'],
  translatePrompt: (draft, ctx) => {
    draft.notes.push(`i18next plural keys end in _${ctx.localeInfo.pluralCategories.join(', _')} for ${ctx.targetLocale}; write one key per category.`)
  },
  templates: [
    {
      template: 'i18next.t(\'{key}\'{args})',
      kinds: ['js-string', 'js-template'],
      imports: ['import i18next from \'i18next\''],
    },
  ],
})
