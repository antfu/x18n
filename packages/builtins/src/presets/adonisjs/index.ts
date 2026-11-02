import type { Preset, Scanner, UsageCandidate } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
import { icu } from '../../placeholders'

/** `defaultLocale: 'en'` and `fallbackLocales: { 'de-CH': 'de' }` from `config/i18n.ts`. */
function readConfig(code: string): { readonly sourceLocale?: string, readonly fallbacks: Record<string, string> } {
  const sourceLocale = /\bdefaultLocale\s*:\s*['"`]([^'"`]+)['"`]/.exec(code)?.[1]
  const block = /\bfallbackLocales\s*:\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
  const fallbacks = Object.fromEntries([
    ...block.matchAll(/['"`]?([\w-]+)['"`]?\s*:\s*['"`]([\w-]+)['"`]/g),
  ].map(match => [match[1]!, match[2]!]))
  return {
    ...sourceLocale
      ? { sourceLocale }
      : {},
    fallbacks,
  }
}

const quotedKey = '[\'"`]([^\'"`\n]+)[\'"`]'

/** `i18nManager.locale('fr').t('key')`, and `.t` on a variable that holds `i18nManager.locale('fr')`. */
const managerScanner: Scanner = {
  id: 'adonisjs-manager',
  extensions: ['ts', 'js', 'mts', 'mjs'],
  scan(file) {
    if (!file.text.includes('i18nManager'))
      return { usages: [] }
    const names = [
      ...file.text.matchAll(/\b(\w+)\s*=\s*i18nManager\s*\.\s*locale\(/g),
    ].map(match => match[1]!)
    const receivers = [
      'i18nManager\\s*\\.\\s*locale\\([^)]*\\)',
      ...names.map(name => `\\b${name}`),
    ]
    const usages: UsageCandidate[] = []
    for (const match of file.text.matchAll(new RegExp(`(?:${receivers.join('|')})\\s*\\.\\s*t\\(\\s*${quotedKey}`, 'dg'))) {
      const [start, end] = match.indices![1]!
      usages.push({
        raw: match[1]!,
        range: { start, end },
        kind: 'call',
        dynamic: false,
      })
    }
    return {
      usages,
      keySlots: usages.map(usage => usage.range),
    }
  },
}

/** AdonisJS: `resources/lang/{locale}/{file}.json` or `.yaml`, with ICU messages. Keys are `file.key`. */
export function adonisjs(): Preset {
  return {
    name: 'adonisjs',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:adonisjs',
        calls: [
          {
            callee: ['i18n.t', 'ctx.i18n.t', 'this.ctx.i18n.t'],
            params: {
              arg: [1],
            },
            defaultValue: [
              { arg: 2 },
            ],
          },
        ],
        regex: [
          {
            extensions: ['edge'],
            patterns: ['(?:^|[^\\w.$])t\\(\\s*[\'"]({key})[\'"]'],
          },
        ],
        resources: [
          { pattern: 'resources/lang/{locale}/{namespaces}.json' },
          { pattern: 'resources/lang/{locale}/{namespaces}.yaml' },
          { pattern: 'resources/lang/{locale}/{namespaces}.yml' },
        ],
        templates: [
          {
            template: 'i18n.t(\'{key}\'{args})',
            kinds: ['js-string', 'js-template'],
          },
        ],
        placeholders: [icu],
        extra: async (draft, ctx) => {
          // VineJS reads validation messages from `validator.json` itself.
          draft.usage = {
            ...draft.usage,
            keysInUse: [...draft.usage.keysInUse, 'validator.shared.**'],
          }
          const code = await ctx.host.readFile('config/i18n.ts')
          if (!code)
            return
          const { sourceLocale, fallbacks } = readConfig(code)
          if (sourceLocale && !ctx.user.sourceLocale)
            draft.sourceLocale = sourceLocale
          if (Object.keys(fallbacks).length && ctx.user.localeFallbacks === undefined)
            draft.localeFallbacks = fallbacks
        },
      }),
      {
        name: 'x18n:adonisjs-manager',
        scanners: [managerScanner],
      },
    ],
  }
}

export default adonisjs
