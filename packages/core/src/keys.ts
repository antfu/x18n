import type { KeyPattern, KeySeparator } from './types/config'
import type { KeyId, KeyString } from './types/model'

/** The text between path segments in a key string: the separator, or `.` when keys are literal. */
export function keyJoiner(separator: KeySeparator): string {
  return separator === false
    ? '.'
    : separator
}

/** Path segments of the part of a key after its namespace. With `false` the whole text is one segment. */
export function splitKeyPath(text: string, separator: KeySeparator = '.'): string[] {
  if (text === '')
    return []
  return separator === false
    ? [text]
    : text.split(separator)
}

/** Canonical string form of a key: `ns:a.b.c`, or `a.b.c` without namespace. `separator` joins the path (`.` by default). */
export function joinKey(namespace: string | undefined, path: readonly string[], separator: KeySeparator = '.'): KeyString {
  const joined = path.join(keyJoiner(separator))
  return namespace === undefined
    ? joined
    : `${namespace}:${joined}`
}

/**
 * Splits a key string. `namespaced` is false for projects without namespaces, where `:` is part of the key.
 * The namespace ends at the first `:`, so the rest of the key may hold more. With `separator: false` the path is one literal segment.
 */
export function splitKey(key: KeyString, namespaced = true, separator: KeySeparator = '.'): KeyId {
  const { namespace, rest } = splitNamespace(key, namespaced)
  return {
    namespace,
    path: splitKeyPath(rest, separator),
  }
}

/** The namespace of a key string and the text after it. */
export function splitNamespace(key: KeyString, namespaced: boolean): { namespace: string | undefined, rest: string } {
  const index = namespaced
    ? key.indexOf(':')
    : -1
  return index === -1
    ? { namespace: undefined, rest: key }
    : {
        namespace: key.slice(0, index),
        rest: key.slice(index + 1),
      }
}

/** The key separator of a resource: its own (from its resource spec), else the config's. */
export function keySeparatorOf(resource: { readonly keySeparator?: KeySeparator | undefined }, fallback: KeySeparator): KeySeparator {
  return resource.keySeparator ?? fallback
}

/** True when `key` is `prefix` itself or lies under it (`a.b` is under `a`). A literal key (`separator: false`) has nothing under it but in its namespace. */
export function isKeyUnder(key: KeyString, prefix: KeyString, separator: KeySeparator = '.'): boolean {
  if (key === prefix)
    return true
  if (prefix.endsWith(':'))
    return key.startsWith(prefix)
  return separator !== false && key.startsWith(prefix + separator)
}

/** Replaces the `from` prefix of `key` with `to`. */
export function replaceKeyPrefix(key: KeyString, from: KeyString, to: KeyString): KeyString {
  return key === from
    ? to
    : to + key.slice(from.length)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Glob over paths. `**` spans separators, `*` and `?` stay inside a segment,
 * `{a,b}` alternates, `[...]` is a character class.
 */
export function globToRegExp(glob: string, separator = '/'): RegExp {
  const sep = escapeRegExp(separator)
  const notSep = `[^${sep}]`
  let out = ''
  let depth = 0
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === separator
        const atStart = i === 0 || glob[i - 1] === separator
        i++
        if (slashAfter && atStart) {
          out += `(?:.*${sep})?`
          i++
        }
        else {
          out += '.*'
        }
      }
      else {
        out += `${notSep}*`
      }
    }
    else if (char === '?') {
      out += notSep
    }
    else if (char === '{') {
      depth++
      out += '(?:'
    }
    else if (char === '}' && depth > 0) {
      depth--
      out += ')'
    }
    else if (char === ',' && depth > 0) {
      out += '|'
    }
    else if (char === '[') {
      const close = glob.indexOf(']', i)
      if (close === -1) {
        out += '\\['
      }
      else {
        out += `[${glob.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
        i = close
      }
    }
    else {
      out += escapeRegExp(char)
    }
  }
  return new RegExp(`^${out}$`)
}

/**
 * Matcher over key patterns. In a glob `*` stays inside a segment and `**` spans segments; with literal keys
 * (`separator: false`) `*` spans the whole key. A regular expression is tested against the whole key as is.
 */
export function keyMatcher(patterns: readonly KeyPattern[], separator: KeySeparator = '.'): (key: KeyString) => boolean {
  if (patterns.length === 0)
    return () => false
  const regexes = patterns.map(pattern => pattern instanceof RegExp
    // `g` and `y` make `test` stateful through `lastIndex`.
    ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
    : globToRegExp(pattern, separator === false
        ? '\u0000'
        : separator))
  return key => regexes.some(re => re.test(key))
}

/** Matcher over posix file paths. */
export function pathMatcher(globs: readonly string[]): (path: string) => boolean {
  if (globs.length === 0)
    return () => false
  const regexes = globs.map(glob => globToRegExp(glob.replace(/^\.\//, '')))
  return path => regexes.some(re => re.test(path))
}
