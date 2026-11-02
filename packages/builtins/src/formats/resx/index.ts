import type { MessageOp, MessageTree, NodeRange, Plugin, TextRange } from '@x18n/core'
import { diffText, errors, pathId, walkLeaves } from '@x18n/core'
import { detectEol, leafText, splice } from '../shared'

interface Entry {
  readonly key: string
  readonly value: string
  readonly range: NodeRange
  /** The `<value>` body; absent without a `<value>` and for `<value/>`. */
  readonly body: TextRange | undefined
  /** A `<value/>` to fill. */
  readonly emptyValue: TextRange | undefined
  /** The inside of `<data>` when it holds something, such as a `<comment>`. */
  readonly content: TextRange | undefined
  /** The `<data>` element. */
  readonly element: TextRange
  /** The element with its indent and line break. */
  readonly line: TextRange
  readonly indent: string
  /** The `<comment>` of the entry, for translators. */
  readonly comment: string | undefined
}

const entities: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: '\'',
}

function decode(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[\da-f]+|#\d+|\w+);/gi, (match, cdata: string | undefined, name: string | undefined) => {
    if (name === undefined)
      return cdata ?? match
    if (name.startsWith('#')) {
      const code = name[1] === 'x'
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10)
      return code <= 0x10FFFF
        ? String.fromCodePoint(code)
        : match
    }
    return entities[name] ?? match
  })
}

const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (text: string): string => escapeText(text).replace(/"/g, '&quot;')

const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\t'

/** The range with its indent and line break when it stands on a line of its own. */
function lineOf(text: string, range: TextRange): TextRange {
  let start = range.start
  while (isSpace(text[start - 1]))
    start--
  let end = range.end
  while (isSpace(text[end]))
    end++
  if (text[end] === '\r')
    end++
  if (text[end] === '\n')
    end++
  const ownLine = (start === 0 || text[start - 1] === '\n') && (end === text.length || text[end - 1] === '\n')
  return ownLine
    ? { start, end }
    : range
}

/** Comments and CDATA are skipped so the schema sample in the standard header is not read as data. */
const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<data\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g

interface Contents {
  readonly entries: Entry[]
  /** Names of `<data>` that hold files, images or other objects. */
  readonly objects: Set<string>
}

/** The `<value>` inside a `<data>` whose content starts at `offset`. */
function valueIn(inner: string, offset: number): Pick<Entry, 'value' | 'body' | 'emptyValue'> {
  const match = /<value\s*\/>|<value\s*>([\s\S]*?)<\/value\s*>/d.exec(inner)
  if (!match)
    return { value: '', body: undefined, emptyValue: undefined }
  const [start, end] = match.indices![0]!
  const body = match.indices![1]
  if (!body) {
    return {
      value: '',
      body: undefined,
      emptyValue: { start: offset + start, end: offset + end },
    }
  }
  return {
    value: decode(match[1]!),
    body: { start: offset + body[0], end: offset + body[1] },
    emptyValue: undefined,
  }
}

function read(text: string, path: string): Contents {
  const entries: Entry[] = []
  const objects = new Set<string>()
  const closing = /<\/data\s*>/g
  tokens.lastIndex = 0
  for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
    const attributes = match[1]
    if (attributes === undefined)
      continue
    const start = match.index
    const open = start + match[0].length
    const selfClosing = attributes.endsWith('/')
    closing.lastIndex = open
    const close = selfClosing
      ? undefined
      : closing.exec(text)
    if (close === null)
      throw errors.X18N2002({ path, reason: 'unclosed <data> element' })
    const end = close
      ? close.index + close[0].length
      : open
    tokens.lastIndex = end
    const name = /\sname\s*=\s*(?:"([^"]*)"|'([^']*)')/d.exec(attributes)
    if (!name)
      continue
    const key = decode(name[1] ?? name[2]!)
    // Files, images and other objects carry a `type` or `mimetype`; only strings are messages.
    if (/\s(?:type|mimetype)\s*=/.test(attributes)) {
      objects.add(key)
      continue
    }
    const nameAt = name.indices![1] ?? name.indices![2]!
    const inner = close
      ? text.slice(open, close.index)
      : ''
    const { value, body, emptyValue } = valueIn(inner, open)
    const line = lineOf(text, { start, end })
    const keyOffset = start + '<data'.length
    entries.push({
      key,
      value,
      range: {
        key: { start: keyOffset + nameAt[0], end: keyOffset + nameAt[1] },
        value: body ?? emptyValue ?? { start: open, end: open },
      },
      body,
      emptyValue,
      content: close && inner.trim()
        ? { start: open, end: close.index }
        : undefined,
      element: { start, end },
      line,
      indent: line.start < start
        ? text.slice(line.start, start)
        : '',
      comment: decode(/<comment\b[^>]*>([\s\S]*?)<\/comment\s*>/.exec(inner)?.[1] ?? '').trim() || undefined,
    })
  }
  return { entries, objects }
}

function dataElement(key: string, value: string, indent: string, eol: string): string {
  return `<data name="${escapeAttribute(key)}" xml:space="preserve">${eol}${indent.repeat(2)}<value>${value}</value>${eol}${indent}</data>`
}

function applyOp(text: string, op: MessageOp, path: string): string {
  const key = op.path.join('.')
  const { entries, objects } = read(text, path)
  const entry = entries.findLast(e => e.key === key)
  if (op.type === 'delete') {
    return entry
      ? splice(text, entry.line, '')
      : text
  }
  // A second `<data name>` would make the file fail to build.
  if (!entry && objects.has(key))
    throw errors.X18N4008({ reason: `"${key}" in ${path} holds a file or object, not a string` })
  const eol = detectEol(text)
  const value = escapeText(leafText(op.value)).replace(/\n/g, eol)
  if (entry?.body)
    return splice(text, entry.body, value)
  if (entry?.emptyValue)
    return splice(text, entry.emptyValue, `<value>${value}</value>`)
  // Before a `<comment>`, on its line and indent.
  if (entry?.content) {
    const lead = /^\s*/.exec(text.slice(entry.content.start, entry.content.end))![0]
    return splice(text, { start: entry.content.start, end: entry.content.start }, `${lead}<value>${value}</value>`)
  }
  if (entry)
    return splice(text, entry.element, dataElement(key, value, entry.indent, eol))
  const root = text.lastIndexOf('</root>')
  if (root === -1)
    throw errors.X18N2002({ path, reason: 'missing </root>' })
  const indent = entries.at(-1)?.indent ?? [
    ...text.matchAll(/^([ \t]*)<resheader\b/gm),
  ].at(-1)?.[1] ?? '  '
  let at = root
  while (isSpace(text[at - 1]))
    at--
  const lead = at === 0 || text[at - 1] === '\n'
    ? ''
    : eol
  return splice(text, { start: at, end: at }, `${lead}${indent}${dataElement(key, value, indent, eol)}${eol}`)
}

const headers: readonly (readonly [string, string])[] = [
  ['resmimetype', 'text/microsoft-resx'],
  ['version', '2.0'],
  ['reader', 'System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089'],
  ['writer', 'System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089'],
]

const head = `<?xml version="1.0" encoding="utf-8"?>\n<root>\n${headers.map(([name, value]) => `  <resheader name="${name}">\n    <value>${value}</value>\n  </resheader>\n`).join('')}`

/** .NET `.resx` files: `<data name="key"><value>text</value></data>` inside `<root>`. */
export function resx(): Plugin {
  return {
    name: 'x18n:format-resx',
    formats: [
      {
        id: 'resx',
        extensions: ['resx'],
        parse(text, ctx) {
          const tree: Record<string, string> = {}
          const ranges = new Map<string, NodeRange>()
          const descriptions = new Map<string, string>()
          for (const entry of read(text, ctx.path).entries) {
            tree[entry.key] = entry.value
            ranges.set(pathId([entry.key]), entry.range)
            if (entry.comment)
              descriptions.set(pathId([entry.key]), entry.comment)
          }
          return { tree, ranges, descriptions }
        },
        edit(text, ops, ctx) {
          let next = text
          for (const op of ops)
            next = applyOp(next, op, ctx.path)
          return diffText(text, next)
        },
        serialize: (tree: MessageTree) => `${head}${[
          ...walkLeaves(tree),
        ]
          .map(leaf => `  ${dataElement(leaf.path.join('.'), escapeText(leafText(leaf.value)), '  ', '\n')}\n`)
          .join('')}</root>\n`,
      },
    ],
  }
}

export default resx
