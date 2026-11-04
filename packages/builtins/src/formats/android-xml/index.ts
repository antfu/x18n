import type { MessageOp, MessageTree, NodeRange, Plugin, TextRange } from '@x18n/core'
import { diffText, errors, pathId, walkLeaves } from '@x18n/core'
import { detectEol, leafText, splice } from '../shared'
import { decodeXml, escapeXmlAttribute, escapeXmlText, indentAt, xmlAttribute, xmlElements, xmlLine } from '../shared/xml'

const quantities = new Set([
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
])
/** The markup Android keeps in a string; anything else with `<` is text. */
const inlineTag = /<\/?(?:[abipsu]|annotation|big|br|font|li|ol|small|span|strike|strong|sub|sup|tt|ul|xliff:g)(?:\s[^<>]*)?\/?>/gi

interface Entry {
  readonly key: string
  readonly value: string
  /** Only for `<string>`: the key of an `<item>` is not text in the file, so it has no range to rename in place. */
  readonly range: NodeRange | undefined
  readonly element: TextRange
  readonly inner: TextRange
  readonly selfClosing: boolean
  readonly comment: string | undefined
  /** The `<plurals>` or `<string-array>` around an `<item>`. */
  readonly parent: Group | undefined
}

interface Group {
  readonly name: string
  readonly element: TextRange
  readonly inner: TextRange
  readonly kind: 'plurals' | 'string-array'
}

/** A value as Android reads it: `\\n`, `\\'` and `\\uXXXX` resolved, and space collapsed outside `"..."`. Inline tags stay as written. */
function decodeValue(raw: string): string {
  let out = ''
  let quoted = false
  let space = false
  const add = (part: string): void => {
    out += (space && out
      ? ' '
      : '') + part
    space = false
  }
  const decode = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!
      if (char === '\\') {
        const next = text[++i]
        if (next === 'u') {
          add(String.fromCharCode(Number.parseInt(text.slice(i + 1, i + 5), 16)))
          i += 4
        }
        else if (next !== undefined) {
          add(({ n: '\n', t: '\t' } as Record<string, string>)[next] ?? next)
        }
      }
      else if (char === '"') {
        quoted = !quoted
      }
      else if (/\s/.test(char) && !quoted) {
        space = true
      }
      else {
        add(char)
      }
    }
  }
  // In CDATA the markup is text, escapes included.
  if (raw.includes('<![CDATA[')) {
    decode(decodeXml(raw))
    return out
  }
  // The quotes of a tag's attributes are XML, not Android quoting.
  let last = 0
  for (const match of raw.matchAll(inlineTag)) {
    decode(decodeXml(raw.slice(last, match.index)))
    add(match[0])
    last = match.index + match[0].length
  }
  decode(decodeXml(raw.slice(last)))
  return out
}

function escapeAndroid(text: string, atStart = true): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return atStart
    ? escaped.replace(/^[@?]/, '\\$&')
    : escaped
}

/** Text for an element: inline tags such as `<b>` stay markup, as written, and other `<` and `&` are escaped. */
function encodeValue(value: string, cdata: boolean): string {
  const quote = /^ | $| {2}/.test(value)
  if (cdata) {
    const text = escapeAndroid(value)
    return `<![CDATA[${quote
      ? `"${text}"`
      : text}]]>`
  }
  let out = ''
  let last = 0
  for (const match of value.matchAll(inlineTag)) {
    out += escapeXmlText(escapeAndroid(value.slice(last, match.index), last === 0)) + match[0]
    last = match.index + match[0].length
  }
  out += escapeXmlText(escapeAndroid(value.slice(last), last === 0))
  return quote
    ? `"${out}"`
    : out
}

function nameRange(text: string, element: { range: TextRange, attributes: string }, tag: string): { name: string, range: TextRange } | undefined {
  const name = xmlAttribute(element.attributes, 'name')
  if (!name)
    return undefined
  const offset = element.range.start + tag.length + 1
  return {
    name: name.value,
    range: { start: offset + name.range.start, end: offset + name.range.end },
  }
}

/** The comment on the lines right above an element, for translators. */
function commentBefore(text: string, start: number): string | undefined {
  const before = text.slice(0, start)
  const from = before.lastIndexOf('<!--')
  if (from === -1)
    return undefined
  const match = /^<!--([\s\S]*?)-->\s*$/.exec(before.slice(from))
  return match && !/\n[ \t]*\n/.test(match[0].slice(match[0].indexOf('-->') + 3))
    ? match[1]!.trim() || undefined
    : undefined
}

function read(text: string): Entry[] {
  const entries: Entry[] = []
  // Not `<string-array>`.
  for (const element of xmlElements(text, 'string(?=[\\s/>])')) {
    const named = nameRange(text, element, 'string')
    if (!named || xmlAttribute(element.attributes, 'translatable')?.value === 'false')
      continue
    entries.push({
      key: named.name,
      value: decodeValue(text.slice(element.inner.start, element.inner.end)),
      range: { key: named.range, value: element.inner },
      element: element.range,
      inner: element.inner,
      selfClosing: element.selfClosing,
      comment: commentBefore(text, element.range.start),
      parent: undefined,
    })
  }
  for (const kind of ['plurals', 'string-array'] as const) {
    for (const group of xmlElements(text, kind)) {
      const named = nameRange(text, group, kind)
      if (!named || xmlAttribute(group.attributes, 'translatable')?.value === 'false')
        continue
      const parent: Group = {
        name: named.name,
        element: group.range,
        inner: group.inner,
        kind,
      }
      xmlElements(text, 'item', group.inner.start, group.inner.end).forEach((item, index) => {
        const quantity = xmlAttribute(item.attributes, 'quantity')?.value
        entries.push({
          key: `${named.name}.${kind === 'plurals'
            ? quantity
            : index}`,
          value: decodeValue(text.slice(item.inner.start, item.inner.end)),
          range: undefined,
          element: item.range,
          inner: item.inner,
          selfClosing: item.selfClosing,
          comment: commentBefore(text, group.range.start),
          parent,
        })
      })
    }
  }
  return entries
}

function addToResources(text: string, element: string, path: string): string {
  const root = text.lastIndexOf('</resources>')
  if (root === -1) {
    if (/<resources\b[^>]*\/>/.test(text))
      return text.replace(/<resources\b([^>]*)\/>/, (_, attributes: string) => `<resources${attributes}>${detectEol(text)}    ${element}${detectEol(text)}</resources>`)
    throw errors.X18N2002({ path, reason: 'missing </resources>' })
  }
  const eol = detectEol(text)
  const lastChild = [
    ...text.slice(0, root).matchAll(/^([ \t]+)<(?:string|plurals|string-array)\b/gm),
  ].at(-1)?.[1] ?? '    '
  let at = root
  while (text[at - 1] === ' ' || text[at - 1] === '\t')
    at--
  const lead = at === 0 || text[at - 1] === '\n'
    ? ''
    : eol
  return splice(text, { start: at, end: at }, `${lead}${lastChild}${element}${eol}`)
}

/** Adds `key` to its group. An array item goes at its index, after empty items for any index in between. */
function addItem(text: string, group: Group, key: string, content: string): string {
  const eol = detectEol(text)
  const suffix = key.slice(group.name.length + 1)
  const items = [
    group.kind === 'plurals'
      ? `<item quantity="${suffix}">${content}</item>`
      : `<item>${content}</item>`,
  ]
  if (group.kind === 'string-array') {
    const count = xmlElements(text, 'item', group.inner.start, group.inner.end).length
    for (let index = count; index < Number(suffix); index++)
      items.unshift('<item/>')
  }
  const closing = group.inner.end
  let at = closing
  while (text[at - 1] === ' ' || text[at - 1] === '\t')
    at--
  const indent = `${indentAt(text, group.element.start)}    `
  const lead = text[at - 1] === '\n'
    ? ''
    : eol
  return splice(text, { start: at, end: closing }, `${lead}${items.map(item => `${indent}${item}${eol}`).join('')}${text.slice(at, closing)}`)
}

function groupOf(text: string, key: string): Group | undefined {
  const at = key.lastIndexOf('.')
  if (at === -1)
    return undefined
  const name = key.slice(0, at)
  for (const kind of ['plurals', 'string-array'] as const) {
    const element = xmlElements(text, kind).find(e => xmlAttribute(e.attributes, 'name')?.value === name)
    if (element) {
      return {
        name,
        element: element.range,
        inner: element.inner,
        kind,
      }
    }
  }
  return undefined
}

function isEmptyItem(text: string, item: { selfClosing: boolean, inner: TextRange }): boolean {
  return item.selfClosing || !text.slice(item.inner.start, item.inner.end).trim()
}

function remove(text: string, entry: Entry): string {
  const { parent } = entry
  if (!parent)
    return splice(text, xmlLine(text, entry.element), '')
  const items = xmlElements(text, 'item', parent.inner.start, parent.inner.end)
  if (parent.kind === 'plurals') {
    return items.length === 1
      ? splice(text, xmlLine(text, parent.element), '')
      : splice(text, xmlLine(text, entry.element), '')
  }
  // Array items are keyed by index: an item before the end empties, so the later ones keep their keys.
  const index = items.findIndex(item => item.range.start === entry.element.start)
  if (index < items.length - 1)
    return splice(text, entry.element, '<item/>')
  let first = index
  while (first > 0 && isEmptyItem(text, items[first - 1]!))
    first--
  if (first === 0)
    return splice(text, xmlLine(text, parent.element), '')
  return splice(text, {
    start: xmlLine(text, items[first]!.range).start,
    end: xmlLine(text, items[index]!.range).end,
  }, '')
}

function newElement(text: string, key: string, content: string): string {
  const at = key.lastIndexOf('.')
  const name = escapeXmlAttribute(key.slice(0, at))
  const suffix = key.slice(at + 1)
  const eol = detectEol(text)
  if (at !== -1 && quantities.has(suffix))
    return `<plurals name="${name}">${eol}        <item quantity="${suffix}">${content}</item>${eol}    </plurals>`
  if (at !== -1 && /^\d+$/.test(suffix)) {
    const items = [
      ...Array.from({
        length: Number(suffix),
      }).fill('<item/>'),
      `<item>${content}</item>`,
    ]
    return `<string-array name="${name}">${eol}${items.map(item => `        ${item}${eol}`).join('')}    </string-array>`
  }
  return `<string name="${escapeXmlAttribute(key)}">${content}</string>`
}

/** Whether `key`, or the group it is an item of, is marked `translatable="false"`. */
function isFixed(text: string, key: string): boolean {
  const at = key.lastIndexOf('.')
  const names = new Set([
    key,
    key.slice(0, at === -1
      ? key.length
      : at),
  ])
  return (['string(?=[\\s/>])', 'plurals', 'string-array'] as const).some(tag => xmlElements(text, tag).some(element =>
    xmlAttribute(element.attributes, 'translatable')?.value === 'false'
    && names.has(xmlAttribute(element.attributes, 'name')?.value ?? '')))
}

function applyOp(text: string, op: MessageOp, path: string): string {
  const key = op.path.join('.')
  const entry = read(text).find(e => e.key === key)
  if (op.type === 'delete') {
    return entry
      ? remove(text, entry)
      : text
  }
  // Not a message: setting it would add a second resource of the same name.
  if (!entry && isFixed(text, key))
    return text
  const raw = leafText(op.value)
  if (entry) {
    const cdata = text.slice(entry.inner.start, entry.inner.end).includes('<![CDATA[')
    const content = encodeValue(raw, cdata)
    if (!entry.selfClosing)
      return splice(text, entry.inner, content)
    const open = text.slice(entry.element.start, entry.element.end).replace(/\s*\/>$/, '')
    const tag = /^<([\w-]+)/.exec(open)![1]
    return splice(text, entry.element, `${open}>${content}</${tag}>`)
  }
  const content = encodeValue(raw, false)
  const group = groupOf(text, key)
  return group
    ? addItem(text, group, key, content)
    : addToResources(text, newElement(text, key, content), path)
}

/** Android `res/values*\/strings.xml`: `<string>`, `<plurals>` as `name.one` and `<string-array>` as `name.0`. `translatable="false"` is not a message. */
export function androidXml(): Plugin {
  return {
    name: 'x18n:format-android-xml',
    formats: [
      {
        id: 'android-xml',
        extensions: ['xml'],
        parse(text) {
          const tree: Record<string, string> = {}
          const ranges = new Map<string, NodeRange>()
          const descriptions = new Map<string, string>()
          for (const entry of read(text)) {
            tree[entry.key] = entry.value
            if (entry.range)
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
        serialize(tree: MessageTree) {
          let out = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n'
          for (const leaf of walkLeaves(tree))
            out = applyOp(out, { type: 'set', path: leaf.path, value: leaf.value }, 'strings.xml')
          return out
        },
      },
    ],
  }
}

export default androidXml
