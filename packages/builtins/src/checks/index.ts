import type { Check, DiagnosticInput, GlossaryEntry, KeyString, MessageChange, Placeholder, Plugin } from '@x18n/core'
import { createPlaceholderComparer, localeSpellingKey } from '@x18n/core'
import { extractableHardStrings } from '../extractors'

function list(items: readonly string[]): string {
  return items.join(', ')
}

export const missingKey: Check = {
  id: 'missing-key',
  defaultSeverity: 'error',
  description: 'A usage whose key is not defined in the source locale.',
  * run(ctx) {
    for (const usage of ctx.undefinedUsages()) {
      yield {
        key: usage.key,
        locale: ctx.sourceLocale,
        location: { path: usage.path, range: usage.range },
        message: `"${usage.key}" is not defined in ${ctx.sourceLocale}.`,
        fixes: [
          {
            title: `Add "${usage.key}" to ${ctx.sourceLocale}`,
            ops: [
              {
                type: 'set',
                key: usage.key!,
                locale: ctx.sourceLocale,
                value: usage.defaultValue ?? '',
              },
            ],
          },
        ],
      }
    }
  },
}

export const missingTranslation: Check = {
  id: 'missing-translation',
  defaultSeverity: 'warning',
  description: 'A source-locale key that target locales lack, or a plural form their language needs. One diagnostic per key, at the source entry.',
  * run(ctx) {
    const missing = new Map<KeyString, string[]>()
    for (const coverage of ctx.coverage()) {
      if (coverage.locale === ctx.sourceLocale)
        continue
      for (const key of coverage.missing) {
        const locales = missing.get(key) ?? []
        missing.set(key, locales)
        locales.push(coverage.locale)
      }
    }
    for (const [key, locales] of missing) {
      const other = ctx.formOf(key)?.keyOf('other')
      const source = ctx.message(key, ctx.sourceLocale) ?? (other === undefined
        ? undefined
        : ctx.message(other, ctx.sourceLocale))
      yield {
        key,
        locale: ctx.sourceLocale,
        message: `"${key}" is missing in ${list(locales)}.`,
        fixes: [
          {
            title: `Add empty values in ${list(locales)}`,
            ops: locales.map(locale => ({
              type: 'set' as const,
              key,
              locale,
              value: '',
            })),
          },
          ...source
            ? [
                {
                  title: 'Copy the source value',
                  ops: locales.map(locale => ({
                    type: 'set' as const,
                    key,
                    locale,
                    value: source.value,
                  })),
                },
              ]
            : [],
        ],
      }
    }
  },
}

function changed(change: MessageChange): string {
  if (!Number.isFinite(change.updatedAt))
    return 'changed locally'
  const revision = change.revision
    ? ` in ${change.revision.slice(0, 7)}`
    : ''
  return `changed ${new Date(change.updatedAt).toISOString().slice(0, 10)}${revision}`
}

export const staleTranslation: Check = {
  id: 'stale-translation',
  defaultSeverity: 'warning',
  description: 'A translation that last changed before its source message, by the history providers (git).',
  * run(ctx) {
    for (const coverage of ctx.coverage()) {
      for (const key of coverage.outdated) {
        yield {
          key,
          locale: coverage.locale,
          message: `"${key}" in ${coverage.locale} is older than ${ctx.sourceLocale} (source ${changed(ctx.history(key, ctx.sourceLocale)!)}).`,
        }
      }
    }
  },
}

export const reviewChangesRequested: Check = {
  id: 'review-changes-requested',
  defaultSeverity: 'info',
  description: 'A message with an open "request change" review.',
  * run(ctx) {
    for (const thread of ctx.reviews({ open: true })) {
      if (thread.state !== 'changes-requested')
        continue
      const request = thread.comments.findLast(comment => comment.type === 'request-change')!
      const by = request.author?.name
        ? ` by ${request.author.name}`
        : ''
      yield {
        key: thread.key,
        locale: thread.locale,
        message: `Change requested${by} for "${thread.key}" in ${thread.locale}${request.text
          ? `: ${request.text}`
          : '.'}`,
        fixes: [
          {
            title: 'Resolve the review',
            ops: [
              { type: 'resolve-review', id: request.id },
            ],
          },
        ],
      }
    }
  },
}

export const emptyTranslation: Check = {
  id: 'empty-translation',
  defaultSeverity: 'warning',
  description: 'A message with an empty string value.',
  * run(ctx) {
    for (const message of ctx.messages()) {
      // An empty message in a locale with a fallback means "use the fallback".
      if (message.value === '' && ctx.fallbacks(message.locale).length === 0)
        yield { key: message.key, locale: message.locale, message: `"${message.key}" is empty in ${message.locale}.` }
    }
  },
}

export const redundantTranslation: Check = {
  id: 'redundant-translation',
  defaultSeverity: 'warning',
  description: 'A message in a locale with a fallback that equals the message it falls back to, so it can be removed.',
  * run(ctx) {
    for (const message of ctx.messages()) {
      if (message.value === '')
        continue
      for (const code of ctx.fallbacks(message.locale)) {
        const inherited = ctx.message(message.key, code)
        if (!inherited || inherited.value === '')
          continue
        if (JSON.stringify(inherited.value) === JSON.stringify(message.value)) {
          yield {
            key: message.key,
            locale: message.locale,
            message: `"${message.key}" in ${message.locale} is the same as in ${code}, which it falls back to.`,
            fixes: [
              {
                title: `Remove "${message.key}" from ${message.locale}`,
                ops: [
                  {
                    type: 'delete',
                    key: message.key,
                    locales: [message.locale],
                  },
                ],
              },
            ],
          }
        }
        break
      }
    }
  },
}

export const keyConflict: Check = {
  id: 'key-conflict',
  defaultSeverity: 'error',
  description: 'A key that is both a leaf and a parent, or is duplicated across files of one locale.',
  * run(ctx) {
    const keys = new Set(ctx.keys())
    for (const key of keys) {
      const segments = key.split('.')
      for (let i = 1; i < segments.length; i++) {
        const parent = segments.slice(0, i).join('.')
        if (keys.has(parent))
          yield { key: parent, message: `"${parent}" is a message and also the parent of "${key}".` }
      }
      for (const locale of ctx.locales) {
        const copies = ctx.duplicates(key, locale)
        if (copies.length > 1) {
          const files = [
            ...new Set(copies.map(m => ctx.resources.find(r => r.id === m.resource)?.path ?? m.resource)),
          ]
          yield { key, locale, message: `"${key}" is defined ${copies.length} times in ${locale} (${list(files)}).` }
        }
      }
    }
  },
}

export const localeCodeConflict: Check = {
  id: 'locale-code-conflict',
  defaultSeverity: 'warning',
  description: 'Locale codes that differ only in spelling, such as zh_CN and zh-CN.',
  * run(ctx) {
    const groups = new Map<string, string[]>()
    for (const locale of ctx.locales) {
      const id = localeSpellingKey(locale)
      const group = groups.get(id) ?? []
      groups.set(id, group)
      group.push(locale)
    }
    for (const group of groups.values()) {
      if (group.length > 1) {
        const resource = ctx.resources.find(r => r.locale === group[1])
        yield {
          locale: group[1],
          location: resource
            ? {
                path: resource.path,
                range: { start: 0, end: 0 },
              }
            : undefined,
          message: `Locale codes ${list(group)} differ only in spelling; they are separate locales.`,
        }
      }
    }
  },
}

export const unusedKey: Check = {
  id: 'unused-key',
  defaultSeverity: 'warning',
  description: 'A key with no usage, after keysInUse, derived keys and dynamic prefixes.',
  * run(ctx) {
    if (!ctx.hasScanners)
      return
    for (const key of ctx.unused()) {
      yield {
        key,
        message: `"${key}" is not used.`,
        fixes: [
          {
            title: `Delete "${key}" in every locale`,
            ops: [
              { type: 'delete', key, locales: 'all' },
            ],
          },
        ],
      }
    }
  },
}

export const placeholderMismatch: Check = {
  id: 'placeholder-mismatch',
  defaultSeverity: 'error',
  description: 'Target value placeholders differ from the source value.',
  * run(ctx) {
    const compare = createPlaceholderComparer(ctx.placeholderSyntaxes, ctx.placeholders)
    for (const key of ctx.keys()) {
      const source = ctx.message(key, ctx.sourceLocale)
      if (typeof source?.value !== 'string')
        continue
      for (const locale of ctx.locales) {
        if (locale === ctx.sourceLocale)
          continue
        const target = ctx.message(key, locale)
        if (typeof target?.value !== 'string' || target.value === '')
          continue
        const { missing, extra } = compare(source.value, target.value)
        if (missing.length || extra.length) {
          const parts = [
            missing.length
              ? `missing ${list(missing)}`
              : '',
            extra.length
              ? `unexpected ${list(extra)}`
              : '',
          ].filter(Boolean)
          yield { key, locale, message: `"${key}" in ${locale} has different placeholders than ${ctx.sourceLocale}: ${parts.join('; ')}.` }
        }
      }
    }
  },
}

/** After the interpolation check of i18next-cli (MIT), src/linter.ts: https://github.com/i18next/i18next-cli */
export const paramMismatch: Check = {
  id: 'param-mismatch',
  defaultSeverity: 'warning',
  description: 'A translate call whose params differ from the placeholders of the source message.',
  * run(ctx) {
    const options = new Set(ctx.config.usage.calls.flatMap(call => call.params?.options ?? []))
    const references = new Set(ctx.placeholderSyntaxes.filter(syntax => syntax.reference).map(syntax => syntax.id))
    for (const usage of ctx.usages()) {
      if (!usage.params || usage.key === undefined || usage.dynamic !== false)
        continue
      const source = ctx.message(usage.key, ctx.sourceLocale)
      if (typeof source?.value !== 'string')
        continue
      const found = ctx.placeholders(source.value)
      // `{{author.name}}` reads the `author` param.
      const used = new Set(found.filter(p => !references.has(p.syntax)).map(p => p.name.split('.')[0]!))
      const missing = [...used].filter(name => !usage.params!.includes(name))
      // Unused params count only in a message with placeholders, and without nested messages (`$t(key)`), which may use any param.
      const extra = used.size === 0 || found.some(p => references.has(p.syntax))
        ? []
        : usage.params.filter(name => !used.has(name) && !options.has(name))
      if (missing.length || extra.length) {
        const parts = [
          missing.length
            ? `missing ${list(missing)}`
            : '',
          extra.length
            ? `unused ${list(extra)}`
            : '',
        ].filter(Boolean)
        yield {
          key: usage.key,
          location: { path: usage.path, range: usage.range },
          message: `The params of "${usage.key}" differ from its placeholders in ${ctx.sourceLocale}: ${parts.join('; ')}.`,
        }
      }
    }
  },
}

export const invalidSyntax: Check = {
  id: 'invalid-syntax',
  defaultSeverity: 'error',
  description: 'Message syntax errors (ICU, linked messages, nesting).',
  * run(ctx) {
    const keys = new Set(ctx.keys())
    const exists = (key: string): boolean => keys.has(key) || ctx.keys().some(k => k.startsWith(`${key}.`))
    for (const message of ctx.messages()) {
      if (typeof message.value !== 'string')
        continue
      const errors = [
        ...ctx.syntaxErrors(message.value),
      ]
      for (const placeholder of ctx.placeholders(message.value)) {
        if (placeholder.syntax === 'linked' && !exists(placeholder.name))
          errors.push(`linked message "${placeholder.name}" does not exist`)
      }
      for (const error of errors)
        yield { key: message.key, locale: message.locale, message: `"${message.key}" in ${message.locale}: ${error}.` }
    }
  },
}

export const dynamicKey: Check = {
  id: 'dynamic-key',
  defaultSeverity: 'off',
  description: 'A fully dynamic key that no check can follow.',
  * run(ctx) {
    for (const usage of ctx.usages()) {
      if (usage.dynamic === 'unknown') {
        yield {
          location: { path: usage.path, range: usage.range },
          message: `Dynamic key "${usage.raw}" cannot be checked.`,
        }
      }
    }
  },
}

// Skip rules after i18next-cli (MIT), status.checkIdentical: https://github.com/i18next/i18next-cli
/** A value that reads the same in every language: no letters once placeholders and tags are removed, a URL, an e-mail address, a short all-caps word or a do-not-translate glossary term. */
function staysTheSame(value: string, placeholders: readonly Placeholder[], terms: ReadonlySet<string>): boolean {
  const chars = value.split('')
  // Placeholders with sub-messages (`{count, plural, one {# item} other {# items}}`) keep their text.
  for (const placeholder of placeholders) {
    if (!/[^{]\{/.test(placeholder.text))
      chars.fill(' ', placeholder.range.start, placeholder.range.end)
  }
  const text = chars.join('').replace(/<[^>]*>/g, ' ').trim()
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  if (!letters || terms.has(text.toLowerCase()))
    return true
  if (/^(?:https?:\/\/|www\.|mailto:)\S*$|^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/i.test(text))
    return true
  return letters <= 5 && !/\p{Ll}/u.test(text)
}

export const identicalToSource: Check = {
  id: 'identical-to-source',
  defaultSeverity: 'info',
  description: 'A target value that equals the source value, except values that stay the same in every language.',
  * run(ctx) {
    // `ctx.localeInfo` is cached; `parseLocaleInfo` builds `Intl` objects, and the analysis reruns on every edit.
    const language = ctx.localeInfo(ctx.sourceLocale).language
    const skipped = new Set(ctx.locales.filter(locale => locale === ctx.sourceLocale || (language !== undefined && ctx.localeInfo(locale).language === language)))
    const terms = new Set(ctx.config.glossary.filter(entry => entry.doNotTranslate).map(entry => entry.term.toLowerCase()))
    for (const message of ctx.messages()) {
      if (skipped.has(message.locale) || typeof message.value !== 'string' || message.value === '')
        continue
      if (ctx.message(message.key, ctx.sourceLocale)?.value === message.value && !staysTheSame(message.value, ctx.placeholders(message.value), terms))
        yield { key: message.key, locale: message.locale, message: `"${message.key}" in ${message.locale} is the same as in ${ctx.sourceLocale}.` }
    }
  },
}

const caseRules: Readonly<Record<string, RegExp>> = {
  camel: /^[a-z][a-zA-Z0-9]*$/,
  snake: /^[a-z][a-z0-9_]*$/,
  kebab: /^[a-z][a-z0-9-]*$/,
  pascal: /^[A-Z][a-zA-Z0-9]*$/,
}

export const keyStyle: Check = {
  id: 'key-style',
  defaultSeverity: 'off',
  description: 'A key that does not match a naming rule (options: case, pattern).',
  * run(ctx) {
    const rule = typeof ctx.options.case === 'string'
      ? caseRules[ctx.options.case]
      : undefined
    const pattern = typeof ctx.options.pattern === 'string'
      ? new RegExp(ctx.options.pattern)
      : undefined
    for (const key of ctx.keys()) {
      const path = key.slice(key.indexOf(':') + 1)
      if (rule && !path.split('.').every(segment => rule.test(segment)))
        yield { key, message: `"${key}" is not ${String(ctx.options.case)} case.` }
      else if (pattern && !pattern.test(key))
        yield { key, message: `"${key}" does not match ${pattern.source}.` }
    }
  },
}

export const hardString: Check = {
  id: 'hard-string',
  defaultSeverity: 'info',
  description: 'A hard-coded string that should probably be a message. On with `extract.autoDetect`.',
  * run(ctx) {
    if (!ctx.config.extract.autoDetect && ctx.config.checks['hard-string'] === undefined)
      return
    for (const hard of extractableHardStrings(ctx.config.extract, ctx.hardStrings(), ctx.text)) {
      yield {
        location: { path: hard.path, range: hard.range },
        message: `Hard-coded string "${hard.text}".`,
      }
    }
  },
}

// Scripts written without spaces between words (or, for Hangul, with particles attached),
// where letters next to a term do not mean it is part of a longer word.
const unspaced = '\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Hangul}\\p{scx=Thai}\\p{scx=Lao}\\p{scx=Khmer}\\p{scx=Myanmar}'
const startsUnspaced = new RegExp(`^[${unspaced}]`, 'u')
const endsUnspaced = new RegExp(`[${unspaced}]$`, 'u')

// A letter or digit of a spaced script, which next to a term makes it part of a longer word.
const spacedWordChar = `(?![${unspaced}])[\\p{L}\\p{N}]`

/**
 * A term as a whole word, so "Home" does not match "Homepage". A plain substring at edges in unspaced scripts,
 * and next to their letters, so "x18n" matches "x18n에".
 */
function wordPattern(term: string): RegExp {
  const before = startsUnspaced.test(term)
    ? ''
    : `(?<!${spacedWordChar})`
  const after = endsUnspaced.test(term)
    ? ''
    : `(?!${spacedWordChar})`
  return new RegExp(`${before}${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${after}`, 'iu')
}

function* glossaryDiagnostics(ctx: Parameters<Check['run']>[0], entry: GlossaryEntry): Generator<DiagnosticInput> {
  const term = wordPattern(entry.term)
  for (const key of ctx.keys()) {
    const source = ctx.message(key, ctx.sourceLocale)?.value
    if (typeof source !== 'string' || !term.test(source))
      continue
    for (const locale of ctx.locales) {
      const value = ctx.message(key, locale)?.value
      const expected = entry.doNotTranslate ? entry.term : entry.translations?.[locale]
      if (locale === ctx.sourceLocale || typeof value !== 'string' || value === '' || !expected)
        continue
      if (!wordPattern(expected).test(value))
        yield { key, locale, message: `"${key}" in ${locale} should use "${expected}" for "${entry.term}".` }
    }
  }
}

export const glossary: Check = {
  id: 'glossary',
  defaultSeverity: 'warning',
  description: 'A glossary term translated differently from the glossary.',
  * run(ctx) {
    for (const entry of ctx.config.glossary)
      yield* glossaryDiagnostics(ctx, entry)
  },
}

export const allChecks: readonly Check[] = [
  missingKey,
  invalidSyntax,
  placeholderMismatch,
  paramMismatch,
  keyConflict,
  missingTranslation,
  staleTranslation,
  reviewChangesRequested,
  emptyTranslation,
  redundantTranslation,
  unusedKey,
  localeCodeConflict,
  dynamicKey,
  identicalToSource,
  keyStyle,
  hardString,
  glossary,
]

/** Every built-in check with its `recommended` severity. */
export function recommended(): Plugin {
  return { name: 'x18n:checks', checks: allChecks }
}
