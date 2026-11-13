import type { LiteralSyntax, MessageLiteral, Placeholder, PlaceholderSyntax, Plugin } from '@x18n/core'

function byRegex(id: string, regex: RegExp, example: string): PlaceholderSyntax {
  return {
    id,
    example,
    find(value) {
      const out: Placeholder[] = []
      for (const match of value.matchAll(regex)) {
        out.push({
          syntax: id,
          text: match[0],
          name: match[1] ?? match[0],
          range: { start: match.index, end: match.index + match[0].length },
        })
      }
      return out
    },
  }
}

/** `{name}`: vue-i18n named interpolation and similar. */
export const braces: PlaceholderSyntax = byRegex('braces', /(?<![{$])\{\s*([\w.-]+)\s*\}(?!\})/g, '{name}')
/** `{}`: easy_localization positional arguments. */
export const positionalBraces: PlaceholderSyntax = byRegex('positional-braces', /\{\}/g, '{}')
/** `{name}` with an optional type, formatters or switch-case: `{name:string}`, `{date|weekday}`, `{gender|{male: his, *: their}}`. `{{a|b}}` plurals are not placeholders. */
export const typedBraces: PlaceholderSyntax = byRegex('typed-braces', /(?<![{$])\{\s*(\w+)\??\s*(?::[^{}|]*)?(?:\|(?:\{[^{}]*\}|[^{}]*))?\}(?!\})/g, '{name}')
/** `{{name}}`: i18next interpolation, including `{{name, format}}` and `{{- raw}}`. */
export const doubleBraces: PlaceholderSyntax = byRegex('double-braces', /\{\{-?\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g, '{{name}}')
/** `%{name}`: Rails, Polyglot. */
export const percentBraces: PlaceholderSyntax = byRegex('percent-braces', /%\{(\w+)\}/g, '%{name}')
/** `%s`, `%d`, `%1$s`: printf. */
export const printf: PlaceholderSyntax = byRegex('printf', /%(?:(\d+)\$)?[-+ 0#]*(?:[1-9]\d*)?(?:\.\d+)?[sdifoxXeEgGc@]/g, '%s')
/**
 * `%(name)s`, `%s`, `%d`: Python percent formatting, as in gettext catalogs. No space flag, so `50% of` is text.
 * URL escapes are text too: those with an uppercase hex letter (`%2F`), and any `%XX` after `://` in the same word (`%20a`).
 */
export const pythonPercent: PlaceholderSyntax = byRegex('python-percent', /(?<!%)%(?![\dA-F][A-F])(?!(?<=:\/\/\S*%)[\dA-Fa-f]{2})(?:\((\w+)\))?[-#0+]*(?:[1-9]\d*|\*)?(?:\.\d+)?[c-giouxXEFGrsa]/g, '%(name)s')
/** `@:key` and `@.modifier:key`: vue-i18n linked messages. */
export const linked: PlaceholderSyntax = {
  ...byRegex('linked', /@(?:\.\w+)?:\(?([\w.-]+)\)?/g, '@:key'),
  reference: true,
}
/** `{ $name }`: Fluent variables. */
export const fluent: PlaceholderSyntax = byRegex('fluent', /\{\s*\$([\w-]+)(?:\s[^}]*)?\}/g, '{ $name }')
/** `:name`: Laravel. */
export const colon: PlaceholderSyntax = byRegex('colon', /(?<![\w:]):([a-z_]\w*)/gi, ':name')
/** `$name$`: Chrome extension messages. */
export const dollars: PlaceholderSyntax = byRegex('dollars', /\$(\w+)\$/g, '$name$')
/** `{$INTERPOLATION}`, `{$START_LINK}`: Angular `$localize` placeholders in translation files. */
export const angular: PlaceholderSyntax = byRegex('angular', /\{\$([A-Z][A-Z0-9_]*)\}/g, '{$NAME}')
/** `{$0}`, `{$1}`: the numbered `<x>` elements of a `lit-localize` XLIFF file. */
export const litXliff: PlaceholderSyntax = byRegex('lit-xliff', /\{\$(\d+)\}/g, '{$0}')

/** `{0}`, `{0:C}`, `{0,-10}`, `{name}`: .NET composite format items. `{{` and `}}` are literal braces. */
export const dotnet: PlaceholderSyntax = {
  id: 'dotnet',
  example: '{0}',
  find(value) {
    const out: Placeholder[] = []
    for (const match of value.matchAll(/\{\{|\}\}|\{\s*(\w+)\s*(?:,\s*-?\d+\s*)?(?::[^{}]*)?\}/g)) {
      if (match[1] !== undefined) {
        out.push({
          syntax: 'dotnet',
          text: match[0],
          name: match[1],
          range: { start: match.index, end: match.index + match[0].length },
        })
      }
    }
    return out
  },
}

/** `$t(key)` nesting in i18next. */
export const nesting: PlaceholderSyntax = {
  ...byRegex('nesting', /\$t\(([\w.:-]+)(?:,[^)]*)?\)/g, '$t(key)'),
  reference: true,
}

/** Offset after the ICU quote that starts with the `'` at `start`: `'{'` and `'}'` are quoted literals, `''` is an apostrophe. */
function skipQuote(value: string, start: number, to: number): number {
  const next = value[start + 1]
  if (next === '\'')
    return start + 2
  if (next !== '{' && next !== '}')
    return start + 1
  let j = start + 1
  while (j < to) {
    if (value[j] === '\'') {
      if (value[j + 1] !== '\'')
        return j + 1
      j++
    }
    j++
  }
  return to
}

/** Offset after the `}` that closes the `{` at `start`, or -1. */
function closingBrace(value: string, start: number, to: number): number {
  let depth = 1
  let j = start + 1
  while (j < to && depth > 0) {
    if (value[j] === '\'') {
      j = skipQuote(value, j, to)
      continue
    }
    if (value[j] === '{')
      depth++
    else if (value[j] === '}')
      depth--
    j++
  }
  return depth > 0
    ? -1
    : j
}

/** ICU MessageFormat arguments: `{name}`, `{count, plural, ...}`. Nested sub-messages are scanned too. */
export const icu: PlaceholderSyntax = {
  id: 'icu',
  example: '{name}',
  find(value) {
    const out: Placeholder[] = []
    const scan = (from: number, to: number): void => {
      let i = from
      while (i < to) {
        const char = value[i]
        if (char === '\'') {
          i = skipQuote(value, i, to)
          continue
        }
        if (char !== '{') {
          i++
          continue
        }
        const j = closingBrace(value, i, to)
        if (j === -1)
          return
        const body = value.slice(i + 1, j - 1)
        const name = /^\s*([\w.-]+)/.exec(body)?.[1]
        if (name) {
          out.push({
            syntax: 'icu',
            text: value.slice(i, j),
            name,
            range: { start: i, end: j },
          })
        }
        // `{n, plural, one {sub} other {sub}}`: the case braces delimit sub-messages, so scan inside each one.
        let k = value.indexOf('{', i + 1)
        while (k !== -1 && k < j - 1) {
          const end = closingBrace(value, k, j - 1)
          if (end === -1)
            break
          scan(k + 1, end - 1)
          k = value.indexOf('{', end)
        }
        i = j
      }
    }
    scan(0, value.length)
    return out
  },
  validate(value) {
    let depth = 0
    let i = 0
    while (i < value.length) {
      const char = value[i]
      if (char === '\'') {
        i = skipQuote(value, i, value.length)
        continue
      }
      if (char === '{')
        depth++
      if (char === '}')
        depth--
      if (depth < 0)
        return [`Unexpected "}" at ${i}`]
      i++
    }
    if (depth > 0)
      return ['Unclosed "{"']
    const errors: string[] = []
    for (const match of value.matchAll(/\{\s*([\w.-]+)\s*,\s*(plural|select|selectordinal)\s*,([\s\S]*)\}/g)) {
      if (!/\bother\s*\{/.test(match[3] ?? ''))
        errors.push(`"${match[1]}" ${match[2]} has no "other" case`)
    }
    return errors
  },
}

/** Registers placeholder syntaxes. Presets call it with their library's syntaxes. */
export function placeholders(...syntaxes: PlaceholderSyntax[]): Plugin {
  return { name: `x18n:placeholders-${syntaxes.map(s => s.id).join('-')}`, placeholders: syntaxes }
}

/** A syntax from a YAML shape such as `{name}`, `{{name}}` or `%{name}`, where `name` marks the name. */
export function placeholderFromShape(shape: string): PlaceholderSyntax {
  const [before, after] = shape.split('name')
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return byRegex(`shape:${shape}`, new RegExp(`${escape(before ?? '')}\\s*([\\w.-]+)\\s*${escape(after ?? '')}`, 'g'), shape)
}

/** Text the message syntax reads as text: a space or a line feed, which is all it skips inside a literal. */
function isSkip(char: string | undefined): boolean {
  return char === ' ' || char === '\n'
}

/** Offset after the spaces at `at`. */
function skipSpaces(value: string, at: number): number {
  let i = at
  while (isSkip(value[i]))
    i++
  return i
}

/** The text of one `\` escape in a literal: `\\`, `\'`, `\uXXXX`, `\UXXXXXX`. Undefined for an unknown one, which the compiler rejects. */
function literalEscape(value: string, at: number): { readonly value: string, readonly end: number } | undefined {
  const next = value[at + 1]
  if (next === '\\' || next === '\'')
    return { value: next, end: at + 2 }
  if (next !== 'u' && next !== 'U')
    return undefined
  const digits = next === 'u'
    ? 4
    : 6
  const hex = value.slice(at + 2, at + 2 + digits)
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length !== digits)
    return undefined
  const codePoint = Number.parseInt(hex, 16)
  if (codePoint > 0x10FFFF)
    return undefined
  // A surrogate is not a code point: the compiler writes a replacement character.
  return {
    value: codePoint <= 0xD7FF || codePoint >= 0xE000
      ? String.fromCodePoint(codePoint)
      : '\uFFFD',
    end: at + 2 + digits,
  }
}

/** The `{'...'}` literal that starts at `at`, when the syntax closes it. */
function quotedLiteralAt(value: string, at: number): MessageLiteral | undefined {
  let i = skipSpaces(value, at + 1)
  if (value[i] !== '\'')
    return undefined
  let text = ''
  let closed = false
  i++
  while (i < value.length) {
    const char = value[i]!
    // A line feed ends the body unterminated, which the compiler rejects.
    if (char === '\n')
      return undefined
    if (char === '\'') {
      closed = true
      i++
      break
    }
    if (char === '\\') {
      const escape = literalEscape(value, i)
      if (!escape)
        return undefined
      text += escape.value
      i = escape.end
      continue
    }
    text += char
    i++
  }
  if (!closed)
    return undefined
  const end = skipSpaces(value, i)
  if (value[end] !== '}')
    return undefined
  return {
    syntax: 'literal',
    text: value.slice(at, end + 1),
    value: text,
    range: { start: at, end: end + 1 },
  }
}

/**
 * `{'@'}` and `\@`: text the syntax decodes instead of reading it as syntax. The escape covers
 * `\@`, `\{`, `\}`, `\|` and `\\`; any other `\` stays text, as the syntax reads it.
 */
export const messageLiteral: LiteralSyntax = {
  id: 'literal',
  find(value) {
    const out: MessageLiteral[] = []
    let i = 0
    while (i < value.length) {
      if (value[i] === '{') {
        const literal = quotedLiteralAt(value, i)
        if (literal) {
          out.push(literal)
          i = literal.range.end
          continue
        }
      }
      else if (value[i] === '\\' && /[\\@{}|]/.test(value[i + 1] ?? '')) {
        out.push({
          syntax: 'literal',
          text: value.slice(i, i + 2),
          value: value[i + 1]!,
          range: { start: i, end: i + 2 },
        })
        i += 2
        continue
      }
      i++
    }
    return out
  },
}
