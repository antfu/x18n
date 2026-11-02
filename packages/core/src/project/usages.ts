import type { ResolvedConfig } from '../types/config'
import type { KeyString, LocaleInfo, TextRange, Usage } from '../types/model'
import type { KeyContext, PluralForm, Scope, UsageCandidate } from '../types/plugin'
import { keyJoiner, pathMatcher } from '../keys'

export interface UsageResolver {
  /** `has` tells whether a key exists, for optional key prefixes and the fallback namespaces. */
  readonly resolve: (candidate: UsageCandidate, scopes: readonly Scope[], path: string, scanner: string, has: (key: KeyString) => boolean) => Usage
}

function innermost(scopes: readonly Scope[], range: TextRange): Scope | undefined {
  let best: Scope | undefined
  for (const scope of scopes) {
    const contains = scope.range.start <= range.start && scope.range.end >= range.end
    if (contains && (!best || scope.range.end - scope.range.start < best.range.end - best.range.start))
      best = scope
  }
  return best
}

function joinPrefix(prefix: string, text: string, joiner: string): string {
  return text
    ? `${prefix}${joiner}${text}`
    : prefix
}

/** The first prefix whose key exists. A prefix usage (`items.${id}`) ends in an empty segment, so its parent key decides. */
function definedPrefix(prefixes: readonly string[], text: string, joiner: string, dynamicPrefix: boolean, exists: (key: string) => boolean): string | undefined {
  return prefixes.find((prefix) => {
    const prefixed = joinPrefix(prefix, text, joiner)
    return exists(dynamicPrefix && prefixed.endsWith(joiner)
      ? prefixed.slice(0, -joiner.length)
      : prefixed)
  })
}

export function createUsageResolver(
  config: ResolvedConfig,
  namespaced: boolean,
  normalizers: readonly ((raw: string, ctx: KeyContext) => string | undefined)[],
): UsageResolver {
  const { separator, fallback } = config.namespace
  const joiner = keyJoiner(config.keySeparator)
  // The key text after the namespace is kept as written, so literal keys keep their `.` and `:`.
  const keyOf = (namespace: string | undefined, text: string): KeyString => namespace === undefined
    ? text
    : `${namespace}:${text}`
  // The first normalizer that returns a value wins.
  const normalize = (raw: string, ctx: KeyContext): string => {
    for (const normalizer of normalizers) {
      const result = normalizer(raw, ctx)
      if (result !== undefined)
        return result
    }
    return raw
  }
  const byFile = Object.entries(config.namespace.byFile).map(([glob, namespace]) => ({
    matches: pathMatcher([glob]),
    namespace,
  }))
  return {
    resolve(candidate, scopes, path, scanner, has) {
      const scope = innermost(scopes, candidate.range)
      let text = normalize(candidate.raw, { path })
      const scopeNamespace = candidate.namespace ?? scope?.namespace ?? byFile.find(rule => rule.matches(path))?.namespace
      let scopePrefix = candidate.keyPrefix ?? scope?.keyPrefix
      let namespace: string | undefined
      let explicit = false
      if (namespaced) {
        const index = separator === false
          ? -1
          : text.indexOf(separator)
        explicit = index > 0
        if (explicit) {
          namespace = text.slice(0, index)
          text = text.slice(index + (separator || '').length)
        }
        else {
          namespace = scopeNamespace ?? config.namespace.default
        }
      }
      // An explicit namespace (`t('common:save')`) leaves the scope's key prefix out.
      if (scopePrefix && !explicit) {
        const optional = !candidate.keyPrefix && scope?.optionalPrefix
        const chosen = optional
          ? definedPrefix([
              scopePrefix,
              ...scope.otherPrefixes ?? [],
            ], text, joiner, candidate.dynamic === 'prefix', lookup => (scope.prefixInFallback
              ? [namespace, ...fallback]
              : [namespace]).some(ns => has(keyOf(ns, lookup))))
          : scopePrefix
        scopePrefix = chosen
        if (chosen)
          text = joinPrefix(chosen, text, joiner)
      }
      let key: KeyString | undefined
      if (candidate.dynamic === 'unknown')
        key = undefined
      else
        key = keyOf(namespace, text)
      if (key !== undefined && namespaced && !explicit && candidate.dynamic === false && !has(key))
        key = fallback.map(ns => keyOf(ns, text)).find(has) ?? key
      return {
        key,
        raw: candidate.raw,
        path,
        range: candidate.range,
        expression: candidate.expression,
        ...candidate.params
          ? {
              params: candidate.params,
            }
          : {},
        ...candidate.defaultValue === undefined
          ? {}
          : {
              defaultValue: candidate.defaultValue,
            },
        ...candidate.description === undefined
          ? {}
          : {
              description: candidate.description,
            },
        scanner,
        kind: candidate.kind,
        dynamic: candidate.dynamic,
        locale: candidate.locale,
        scopeNamespace,
        scopePrefix,
      }
    },
  }
}

/** True when a prefix usage may refer to `key`. The key of `t(`pages.${id}`)` is `pages.`, so only children match. */
export function prefixMatches(usage: Usage, key: KeyString): boolean {
  return usage.dynamic === 'prefix' && usage.key !== undefined && key.startsWith(usage.key)
}

/** Ranges covered by `x18n-disable-next-line` and `x18n-disable` ... `x18n-enable` comments. */
export function suppressedRanges(text: string): TextRange[] {
  if (!text.includes('x18n-disable'))
    return []
  const ranges: TextRange[] = []
  const nextLine = /x18n-disable-next-line/g
  for (const match of text.matchAll(nextLine)) {
    const lineEnd = text.indexOf('\n', match.index)
    if (lineEnd === -1)
      continue
    const nextEnd = text.indexOf('\n', lineEnd + 1)
    ranges.push({
      start: lineEnd + 1,
      end: nextEnd === -1
        ? text.length
        : nextEnd,
    })
  }
  const block = /x18n-disable(?![-\w])/g
  for (const match of text.matchAll(block)) {
    const end = text.indexOf('x18n-enable', match.index)
    ranges.push({
      start: match.index,
      end: end === -1
        ? text.length
        : end,
    })
  }
  return ranges
}

/** The plural categories of a locale's language: Japanese has only `other`. `required` keeps those whole numbers select. */
export function categoriesOf(info: LocaleInfo, type: Intl.PluralRuleType, required = false): readonly Intl.LDMLPluralRule[] {
  if (required) {
    const allowed = categoriesOf(info, type)
    return (type === 'ordinal'
      ? info.requiredOrdinalCategories
      : info.requiredPluralCategories).filter(category => category === 'other' || allowed.includes(category))
  }
  return type === 'ordinal'
    ? info.ordinalCategories
    : info.pluralCategories
}

export interface DerivedKeys {
  /** Base keys of a key, nearest first. Suffixes stack, so `friend_male_one` derives from `friend_male` and `friend`. */
  readonly basesOf: (key: KeyString) => KeyString[]
  readonly formOf: (key: KeyString) => PluralForm | undefined
}

const tokens = /(\{key\}|\{plural\}|\{ordinal\}|\*)/
const categories: readonly Intl.LDMLPluralRule[] = [
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
]

/**
 * Compiles derived-key rules (`{key}_plural`, `{key}_*`, `{key}_{plural}`). `*` is any key segment;
 * `{plural}` and `{ordinal}` are CLDR plural categories, which each locale needs its own set of.
 */
export function derivedKeys(rules: readonly string[]): DerivedKeys {
  const compiled = rules.map((rule) => {
    const parts = rule.split(tokens)
    const type: Intl.PluralRuleType | undefined = parts.includes('{ordinal}')
      ? 'ordinal'
      : parts.includes('{plural}')
        ? 'cardinal'
        : undefined
    const source = parts.map((part) => {
      if (part === '{key}')
        return '(?<key>.+)'
      if (part === '{plural}' || part === '{ordinal}')
        return `(?<category>${categories.join('|')})`
      if (part === '*')
        return '[^.:]+'
      return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    }).join('')
    return {
      type,
      re: new RegExp(`^${source}$`, 'd'),
    }
  })
  const baseOf = (key: KeyString): KeyString | undefined => {
    for (const { re } of compiled) {
      const base = re.exec(key)?.groups?.key
      if (base)
        return base
    }
    return undefined
  }
  return {
    basesOf(key) {
      const bases: KeyString[] = []
      for (let base = baseOf(key); base !== undefined; base = baseOf(base))
        bases.push(base)
      return bases
    },
    formOf(key) {
      let best: (PluralForm & { readonly base: string }) | undefined
      for (const { type, re } of compiled) {
        const match = type && re.exec(key)
        if (!type || !match)
          continue
        const base = match.groups?.key
        const category = categories.find(c => c === match.groups?.category)
        const at = match.indices?.groups?.category
        // The rule that takes the longest suffix wins: `place_ordinal_one` is an ordinal of `place`.
        if (!base || !category || !at || (best && best.base.length <= base.length))
          continue
        const [start, end] = at
        best = {
          base,
          type,
          category,
          keyOf: other => `${key.slice(0, start)}${other}${key.slice(end)}`,
        }
      }
      return best
    },
  }
}
