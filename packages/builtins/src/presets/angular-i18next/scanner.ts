import type { Scanner, Scope, TextRange, UsageCandidate } from '@x18n/core'
import { angularTemplates } from '../shared/angular-templates'

/** The namespace and scope a provider gives the pipes under it. */
export interface PipeScope {
  readonly namespace?: string | undefined
  readonly keyPrefix?: string | undefined
  readonly otherPrefixes?: readonly string[] | undefined
}

export interface ProjectFacts {
  /** Pipe scopes by template file, or by folder ending in `/` for a list of providers that names no component. */
  readonly scopes: Map<string, PipeScope>
  /** Pipe scopes by the part of a file a component holds, since a file can hold several. */
  readonly spans: Map<string, readonly (TextRange & { readonly scope: PipeScope })[]>
  /** `Title` is `I18NextTitle`, so `setTitle` takes a key. */
  titles: boolean
}

/** What `i18nextPipe.transform` and `Service.t` already read from their own options, not params of the message. */
const pipeOptions = new Set([
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
  'format',
  'prependScope',
  'prependNamespace',
  'case',
])

const defaultCallees = new Set([
  'i18n',
  'i18next',
  'i18NextService',
  'i18nextService',
  'translationService',
  'i18NextPipe',
  'i18nextPipe',
])

/** The value of a string option in an object literal. */
function stringOption(options: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*:\\s*(['"\`])([^'"\`]*)\\1`).exec(options)?.[2]
}

/** The text of the `{ ... }` starting at `start`, when there is one. */
export function objectAt(text: string, start: number): string | undefined {
  if (text[start] !== '{')
    return undefined
  let depth = 0
  let quote: string | undefined
  for (let i = start; i < text.length; i++) {
    const char = text[i]!
    if (quote) {
      if (char === '\\')
        i++
      else if (char === quote)
        quote = undefined
    }
    else if (char === '\'' || char === '"' || char === '`') {
      quote = char
    }
    else if (char === '{') {
      depth++
    }
    else if (char === '}' && --depth === 0) {
      return text.slice(start, i + 1)
    }
  }
  return undefined
}

/** The params of an options object, when they are all named: no spread and no nested names. */
function paramNames(options: string): string[] | undefined {
  if (options.includes('...'))
    return undefined
  let flat = options.slice(1, -1)
  for (let before = ''; before !== flat;) {
    before = flat
    flat = flat.replace(/\{[^{}]*\}|\[[^[\]]*\]|\([^()]*\)|'[^']*'|"[^"]*"|`[^`]*`/g, '_')
  }
  return flat.split(',').map(part => /^\s*(\w+)\s*(?::|$)/.exec(part)?.[1]).filter((name): name is string => !!name && !pipeOptions.has(name))
}

function fromOptions(options: string | undefined): Partial<UsageCandidate> {
  if (!options)
    return {}
  const namespace = stringOption(options, 'ns')
  const defaultValue = stringOption(options, 'defaultValue')
  const params = paramNames(options)
  return {
    ...namespace
      ? { namespace }
      : {},
    ...defaultValue !== undefined
      ? { defaultValue }
      : {},
    ...params
      ? { params }
      : {},
  }
}

/** The options after a pipe name, as in `| i18next: { count: 2 }`. */
function pipeArgument(text: string, end: number): string | undefined {
  const colon = /^\s*:\s*/.exec(text.slice(end, end + 40))
  return colon
    ? objectAt(text, end + colon[0].length)
    : undefined
}

const quoted = '[`\'"]([^`\'"\\n]+)[`\'"]'
const pipeName = '\\|\\s*i18next(?:Eager|Cap)?\\b'

type Usage = UsageCandidate & { readonly scoped: boolean }

interface Found {
  readonly raw: string
  readonly start: number
  readonly dynamic: UsageCandidate['dynamic']
}

/** The text between the bracket that ends `before` and the one that opens it. */
function bracketed(before: string): { readonly inner: string, readonly at: number } | undefined {
  const close = before.at(-1)
  const open = close === ')'
    ? '('
    : '['
  let depth = 0
  for (let at = before.length - 1; at >= 0; at--) {
    if (before[at] === close) {
      depth++
    }
    else if (before[at] === open && --depth === 0) {
      return {
        inner: before.slice(at + 1, -1),
        at: at + 1,
      }
    }
  }
  return undefined
}

/** `'a'`, or the known part of `` `a.${b}` ``. */
function literalKey(before: string): Found | undefined {
  const literal = new RegExp(`${quoted}$`, 'd').exec(before)
  if (!literal)
    return undefined
  const raw = literal[1]!
  const start = literal.indices![1]![0]
  const at = raw.indexOf('${')
  return at === -1
    ? { raw, start, dynamic: false }
    : {
        raw: raw.slice(0, at).replace(/\\$/, ''),
        start,
        dynamic: 'prefix',
      }
}

/** `('a.' + b)`, `(on ? 'x' : 'y')` or `['x', 'y']`: the literals that are keys, never a condition. */
function bracketedKeys(before: string): Found[] {
  const last = before.at(-1)
  const found = last === ')' || last === ']'
    ? bracketed(before)
    : undefined
  if (!found)
    return []
  const prefix = /^\s*[`'"]([^`'"\n]*)[`'"]\s*\+/d.exec(found.inner)
  if (prefix) {
    return [
      { raw: prefix[1]!, start: found.at + prefix.indices![1]![0], dynamic: 'prefix' },
    ]
  }
  if (last === ')' && !found.inner.includes('?'))
    return []
  const question = last === ']'
    ? -1
    : found.inner.lastIndexOf('?')
  return [
    ...found.inner.matchAll(new RegExp(quoted, 'dg')),
  ]
    .filter(item => item.index > question)
    .map(item => ({ raw: item[1]!, start: found.at + item.indices![1]![0], dynamic: false as const }))
}

function pipeKeys(before: string): Found[] {
  const literal = literalKey(before)
  if (literal)
    return [literal]
  const keys = bracketedKeys(before)
  if (keys.length)
    return keys
  const name = /([\w$.?!()[\]]+)$/d.exec(before)
  return name
    ? [
        { raw: name[1]!, start: name.indices![1]![0], dynamic: 'unknown' },
      ]
    : []
}

/** Every key a pipe reads in a template: literals, ternaries, arrays, a prefix before `+` or `${`, and unknown names. */
function pipeUsages(text: string): Usage[] {
  const out: Usage[] = []
  for (const match of text.matchAll(new RegExp(pipeName, 'g'))) {
    const argument = pipeArgument(text, match.index + match[0].length)
    const base = Math.max(0, match.index - 500)
    const before = text.slice(base, match.index).trimEnd()
    for (const { raw, start, dynamic } of pipeKeys(before)) {
      out.push({
        raw,
        range: { start: base + start, end: base + start + raw.length },
        kind: 'call',
        dynamic,
        scoped: !(argument && /\bprepend(?:Scope|Namespace)\s*:\s*false\b/.test(argument)),
        ...fromOptions(argument),
      })
    }
  }
  return out
}

/** Names a class gives a service, whatever they are: `@Inject(I18NEXT_SERVICE) private i18: X` or `t = inject(I18NextService)`. */
export function boundNames(code: string, types: string, token?: string): Set<string> {
  const names = new Set<string>()
  const injected = token
    ? `${token}|${types}`
    : types
  for (const match of code.matchAll(new RegExp(`\\b(\\w+)\\s*(?::\\s*(?:${types})\\b|=\\s*inject\\(\\s*(?:${injected})\\b)`, 'g')))
    names.add(match[1]!)
  if (token) {
    for (const match of code.matchAll(new RegExp(`@Inject\\(\\s*${token}\\s*\\)\\s*(?:(?:private|protected|public|readonly)\\s+)*(\\w+)`, 'g')))
      names.add(match[1]!)
  }
  return names
}

/** `name.method('key', { ns })` for each name, with the key as an argument. */
function callUsages(code: string, names: ReadonlySet<string>, methods: string, scoped: boolean): Usage[] {
  const out: Usage[] = []
  for (const name of names) {
    if (defaultCallees.has(name))
      continue
    for (const match of code.matchAll(new RegExp(`\\b${name}\\s*\\??\\.\\s*(?:${methods})\\(\\s*${quoted}\\s*(,\\s*)?`, 'dg'))) {
      const options = match[2]
        ? objectAt(code, match.index + match[0].length)
        : undefined
      const [start, end] = match.indices![1]!
      out.push({
        raw: match[1]!,
        range: { start, end },
        kind: 'call',
        dynamic: false,
        scoped,
        ...fromOptions(options),
      })
    }
  }
  return out
}

function scopeFor(path: string, offset: number, facts: ProjectFacts): PipeScope | undefined {
  const span = facts.spans.get(path)?.find(item => offset >= item.start && offset < item.end)
  if (span)
    return span.scope
  const own = facts.scopes.get(path)
  if (own)
    return own
  let best: string | undefined
  for (const folder of facts.scopes.keys()) {
    if (folder.endsWith('/') && path.startsWith(folder) && (!best || folder.length > best.length))
      best = folder
  }
  return best === undefined
    ? undefined
    : facts.scopes.get(best)
}

/**
 * Usages of `angular-i18next`: the pipes in templates, the services and pipes a class injects under any name, and
 * `setTitle` when `Title` is `I18NextTitle`. A provider's namespace and scope reach pipes only, as in the library.
 */
export function angularI18nextScanner(facts: ProjectFacts): Scanner {
  return {
    id: 'angular-i18next',
    extensions: [...angularTemplates, 'mts', 'mjs'],
    scan(file) {
      const code = file.extension !== 'html'
      const found = pipeUsages(file.text)
      if (code) {
        found.push(
          ...callUsages(file.text, boundNames(file.text, 'I18NextService|ITranslationService', 'I18NEXT_SERVICE'), 't|exists', false),
          ...callUsages(file.text, boundNames(file.text, 'I18NextPipe|I18NextCapPipe|I18NextEagerPipe'), 'transform', true),
        )
        if (facts.titles)
          found.push(...callUsages(file.text, boundNames(file.text, 'Title'), 'setTitle', true))
      }
      const scopes: Scope[] = found
        .filter(usage => usage.scoped && !usage.namespace)
        .flatMap((usage) => {
          const scope = scopeFor(file.path, usage.range.start, facts)
          if (!scope)
            return []
          return [
            {
              range: usage.range,
              namespace: scope.namespace,
              ...scope.keyPrefix
                ? {
                    keyPrefix: scope.keyPrefix,
                    optionalPrefix: true,
                    otherPrefixes: scope.otherPrefixes,
                    prefixInFallback: true,
                  }
                : {},
            },
          ]
        })
      const usages = found.map(({ scoped: _, ...usage }) => usage)
      return {
        usages,
        scopes,
        keySlots: usages.filter(usage => usage.dynamic === false).map(usage => usage.range),
      }
    },
  }
}
