import type { MessageOp, MessageTree, NodeRange, Plugin, TextRange } from '@x18n/core'
import { diffText, errors, pathId, walkLeaves } from '@x18n/core'
import { detectEol, leafText, splice } from '../shared'
import { decodeXml, escapeXmlAttribute, indentAt, xmlAttribute, xmlElements, xmlLine } from '../shared/xml'

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
  readonly range: NodeRange
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

/** A value as Android reads it: `\\n`, `\\'` and `\\uXXXX` resolved, and space collapsed outside `"..."`. */
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
  const text = decodeXml(raw)
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
  return out
}

function escapeAndroid(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/^[@?]/, '\\$&')
}

/** Text for an element: inline tags such as `<b>` stay markup, and other `<` and `&` are escaped. */
function encodeValue(value: string, cdata: boolean): string {
  const text = /^ | $| {2}/.test(value)
    ? `"${escapeAndroid(value)}"`
    : escapeAndroid(value)
  if (cdata)
    return `<![CDATA[${text}]]>`
  let out = ''
  let last = 0
  const escape = (part: string): string => part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  for (const match of text.matchAll(inlineTag)) {
    out += escape(text.slice(last, match.index)) + match[0]
    last = match.index + match[0].length
  }
  return out + escape(text.slice(last))
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
  const match = /<!--([\s\S]*?)-->\s*$/.exec(text.slice(0, start))
  return match && !/\n[ \t]*\n/.test(text.slice(match.index + match[0].trimEnd().length, start))
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
          range: { key: named.range, value: item.inner },
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

function addItem(text: string, group: Group, key: string, content: string): string {
  const eol = detectEol(text)
  const suffix = key.slice(group.name.length + 1)
  const item = group.kind === 'plurals'
    ? `<item quantity="${suffix}">${content}</item>`
    : `<item>${content}</item>`
  const closing = group.inner.end
  let at = closing
  while (text[at - 1] === ' ' || text[at - 1] === '\t')
    at--
  const indent = `${indentAt(text, group.element.start)}    `
  const lead = text[at - 1] === '\n'
    ? ''
    : eol
  return splice(text, { start: at, end: closing }, `${lead}${indent}${item}${eol}${text.slice(at, closing)}`)
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

function remove(text: string, entry: Entry): string {
  const { parent } = entry
  if (parent && xmlElements(text, 'item', parent.inner.start, parent.inner.end).length === 1)
    return splice(text, xmlLine(text, parent.element), '')
  return splice(text, xmlLine(text, entry.element), '')
}

function newElement(text: string, key: string, content: string): string {
  const at = key.lastIndexOf('.')
  const suffix = key.slice(at + 1)
  if (at === -1 || !quantities.has(suffix))
    return `<string name="${escapeXmlAttribute(key)}">${content}</string>`
  const eol = detectEol(text)
  return `<plurals name="${escapeXmlAttribute(key.slice(0, at))}">${eol}        <item quantity="${suffix}">${content}</item>${eol}    </plurals>`
}

function applyOp(text: string, op: MessageOp, path: string): string {
  const key = op.path.join('.')
  const entry = read(text).find(e => e.key === key)
  if (op.type === 'delete') {
    return entry
      ? remove(text, entry)
      : text
  }
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
