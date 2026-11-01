import type { MessageOp, MessageState, MessageTree, NodeRange, Plugin, TextRange } from '@x18n/core'
import type { XmlElement } from '../shared/xml'
import { diffText, errors, pathId, walkLeaves } from '@x18n/core'
import { detectEol, leafText, splice } from '../shared'
import { decodeXml, escapeXmlAttribute, escapeXmlText, indentAt, xmlAttribute, xmlChild, xmlElements, xmlLine } from '../shared/xml'

type Version = '1.2' | '2.0'

interface Unit {
  readonly id: string
  readonly idRange: TextRange
  readonly element: XmlElement
  readonly source: XmlElement | undefined
  readonly target: XmlElement | undefined
  /** The unit's notes for translators, joined; undefined without one. */
  readonly description: string | undefined
  /** `state` of the 1.2 `<target>` or the 2.0 `<segment>`. */
  readonly state: string | undefined
}

/**
 * Notes for translators in a unit: those without a kind and the `description` and `meaning` ones (`from` in 1.2,
 * `category` in 2.0). Location notes point at code and are left out.
 */
function notesOf(text: string, unit: XmlElement): string | undefined {
  const notes = xmlElements(text, 'note', unit.inner.start, unit.inner.end).flatMap((note) => {
    const kind = (xmlAttribute(note.attributes, 'from') ?? xmlAttribute(note.attributes, 'category'))?.value
    const content = decodeXml(text.slice(note.inner.start, note.inner.end)).trim()
    if (!content || (kind !== undefined && kind !== 'description' && kind !== 'meaning'))
      return []
    return [
      kind === 'meaning'
        ? `Meaning: ${content}`
        : content,
    ]
  })
  return notes.length > 0
    ? notes.join('\n')
    : undefined
}

interface Document {
  readonly version: Version
  /** A translation file reads and writes `<target>`; a source file (no target language, no target) `<source>`. */
  readonly translation: boolean
  readonly units: Unit[]
}

function read(text: string): Document {
  const version: Version = /<xliff\s[^>]*\bversion\s*=\s*["']2/.test(text)
    ? '2.0'
    : '1.2'
  const units: Unit[] = []
  for (const element of xmlElements(text, version === '2.0'
    ? 'unit'
    : 'trans-unit')) {
    const id = xmlAttribute(element.attributes, 'id')
    if (!id)
      continue
    const segment = version === '2.0'
      ? xmlChild(text, 'segment', element.inner)
      : undefined
    const holder = segment?.inner ?? element.inner
    const attributesAt = element.range.start + text.slice(element.range.start).indexOf(element.attributes)
    const target = xmlChild(text, 'target', holder)
    units.push({
      id: id.value,
      idRange: { start: attributesAt + id.range.start, end: attributesAt + id.range.end },
      element,
      source: xmlChild(text, 'source', holder),
      target,
      description: notesOf(text, element),
      state: xmlAttribute((version === '2.0'
        ? segment
        : target)?.attributes ?? '', 'state')?.value,
    })
  }
  const translation = version === '2.0'
    ? /<xliff\s[^>]*\btrgLang\s*=/.test(text)
    : /<file\s[^>]*\btarget-language\s*=/.test(text)
  return { version, translation: translation || units.some(u => u.target), units }
}

/** A 1.2 target state or a 2.0 segment state as a message state; `new` and `initial` have none. */
function stateOf(state: string | undefined): MessageState | undefined {
  if (state === 'translated')
    return 'translated'
  if (state === 'reviewed' || state === 'final' || state === 'signed-off')
    return 'reviewed'
  return state?.startsWith('needs-')
    ? 'needs-review'
    : undefined
}

/** Message text of XLIFF content: `<x id>`, `<ph equiv>` and `<pc equivStart equivEnd>` read as `{$NAME}`. */
function toMessage(content: string, version: Version): string {
  let out = ''
  const ends: string[] = []
  const tag = /<(\/?)(x|ph|pc)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  let last = 0
  for (const match of content.matchAll(tag)) {
    out += decodeXml(content.slice(last, match.index))
    last = match.index + match[0].length
    const closing = match[1]
    const name = match[2]
    const attributes = match[3] ?? ''
    if (name === 'pc') {
      if (closing) {
        const end = ends.pop()
        if (end)
          out += `{$${end}}`
      }
      else {
        const start = xmlAttribute(attributes, 'equivStart')?.value
        ends.push(xmlAttribute(attributes, 'equivEnd')?.value ?? '')
        if (start)
          out += `{$${start}}`
      }
      continue
    }
    if (closing)
      continue
    const placeholder = xmlAttribute(attributes, version === '2.0'
      ? 'equiv'
      : 'id')?.value
    if (placeholder)
      out += `{$${placeholder}}`
  }
  return out + decodeXml(content.slice(last))
}

/** XLIFF content of a message, reusing the placeholder markup of `source` so `equiv-text`, `disp` and `type` survive. */
function toContent(message: string, version: Version, source: string): string {
  const singles = new Map<string, string>()
  const pairs = new Map<string, { open: string, end: string }>()
  let nextId = 0
  for (const match of source.matchAll(/<(x|ph|pc)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g)) {
    const markup = match[0]
    const name = match[1]
    const attributes = match[2] ?? ''
    const id = Number(xmlAttribute(attributes, 'id')?.value)
    if (Number.isInteger(id))
      nextId = Math.max(nextId, id + 1)
    if (name === 'pc') {
      const start = xmlAttribute(attributes, 'equivStart')?.value
      if (start)
        pairs.set(start, { open: markup, end: xmlAttribute(attributes, 'equivEnd')?.value ?? '' })
    }
    else {
      const placeholder = xmlAttribute(attributes, version === '2.0'
        ? 'equiv'
        : 'id')?.value
      if (placeholder)
        singles.set(placeholder, markup)
    }
  }
  let out = ''
  const open: string[] = []
  let last = 0
  for (const match of message.matchAll(/\{\$([\w-]+)\}/g)) {
    out += escapeXmlText(message.slice(last, match.index))
    last = match.index + match[0].length
    const name = match[1]!
    const pair = pairs.get(name)
    if (pair) {
      out += pair.open
      open.push(pair.end)
    }
    else if (open.at(-1) === name) {
      open.pop()
      out += '</pc>'
    }
    else {
      out += singles.get(name) ?? (version === '2.0'
        ? `<ph id="${nextId++}" equiv="${escapeXmlAttribute(name)}"/>`
        : `<x id="${escapeXmlAttribute(name)}"/>`)
    }
  }
  out += escapeXmlText(message.slice(last))
  // A `<pc>` left open by a translation that dropped its end placeholder still has to close.
  return out + '</pc>'.repeat(open.length)
}

function setValue(text: string, unit: Unit, doc: Document, value: string): string {
  const eol = detectEol(text)
  const content = toContent(value, doc.version, unit.source
    ? text.slice(unit.source.inner.start, unit.source.inner.end)
    : '').replace(/\n/g, eol)
  const tag = doc.translation
    ? 'target'
    : 'source'
  const existing = doc.translation
    ? unit.target
    : unit.source
  if (existing && !existing.selfClosing)
    return splice(text, existing.inner, content)
  if (existing)
    return splice(text, existing.range, `<${tag}>${content}</${tag}>`)
  if (unit.source) {
    const indent = indentAt(text, unit.source.range.start)
    return splice(text, { start: unit.source.range.end, end: unit.source.range.end }, `${eol}${indent}<target>${content}</target>`)
  }
  const at = unit.element.inner.start
  return splice(text, { start: at, end: at }, `<${tag}>${content}</${tag}>`)
}

function newUnit(id: string, content: string, doc: Document, indent: string, step: string, eol: string): string {
  const tag = doc.translation
    ? 'target'
    : 'source'
  const inner = `${indent}${step}`
  return doc.version === '2.0'
    ? [
        `<unit id="${escapeXmlAttribute(id)}">`,
        `${inner}<segment>`,
        `${inner}${step}<${tag}>${content}</${tag}>`,
        `${inner}</segment>`,
        `${indent}</unit>`,
      ].join(eol)
    : [`<trans-unit id="${escapeXmlAttribute(id)}" datatype="html">`, `${inner}<${tag}>${content}</${tag}>`, `${indent}</trans-unit>`].join(eol)
}

function applyOp(text: string, op: MessageOp, path: string): string {
  const id = op.path.join('.')
  const doc = read(text)
  const unit = doc.units.findLast(u => u.id === id)
  if (op.type === 'delete') {
    return unit
      ? splice(text, xmlLine(text, unit.element.range), '')
      : text
  }
  const value = leafText(op.value)
  if (unit)
    return setValue(text, unit, doc, value)
  const eol = detectEol(text)
  const closing = doc.version === '2.0'
    ? text.lastIndexOf('</file>')
    : text.lastIndexOf('</body>')
  if (closing === -1) {
    throw errors.X18N2002({
      path,
      reason: doc.version === '2.0'
        ? 'missing </file>'
        : 'missing </body>',
    })
  }
  const previous = doc.units.at(-1)
  const indent = previous
    ? indentAt(text, previous.element.range.start)
    : `${indentAt(text, closing)}  `
  const step = indent.slice(indentAt(text, closing).length) || '  '
  let at = closing
  while (text[at - 1] === ' ' || text[at - 1] === '\t')
    at--
  const lead = text[at - 1] === '\n'
    ? ''
    : eol
  return splice(text, { start: at, end: at }, `${lead}${indent}${newUnit(id, toContent(value, doc.version, ''), doc, indent, step, eol)}${eol}`)
}

/** XLIFF 1.2 and 2.0, as Angular's `ng extract-i18n` writes them: one message per unit, placeholders as `{$NAME}`. */
export function xliff(): Plugin {
  return {
    name: 'x18n:format-xliff',
    formats: [
      {
        id: 'xliff',
        extensions: ['xlf', 'xliff'],
        parse(text) {
          const doc = read(text)
          const tree: Record<string, string> = {}
          const ranges = new Map<string, NodeRange>()
          const descriptions = new Map<string, string>()
          const states = new Map<string, MessageState>()
          for (const unit of doc.units) {
            const holder = doc.translation
              ? unit.target
              : unit.source
            if (!holder)
              continue
            tree[unit.id] = toMessage(text.slice(holder.inner.start, holder.inner.end), doc.version)
            ranges.set(pathId([unit.id]), { key: unit.idRange, value: holder.inner })
            if (unit.description)
              descriptions.set(pathId([unit.id]), unit.description)
            const state = doc.translation
              ? stateOf(unit.state)
              : undefined
            if (state)
              states.set(pathId([unit.id]), state)
          }
          return { tree, ranges, descriptions, states }
        },
        edit(text, ops, ctx) {
          let next = text
          for (const op of ops)
            next = applyOp(next, op, ctx.path)
          return diffText(text, next)
        },
        serialize: (tree: MessageTree, ctx) => {
          const doc: Document = { version: '1.2', translation: true, units: [] }
          const units = [
            ...walkLeaves(tree),
          ].map(leaf => `      ${newUnit(leaf.path.join('.'), toContent(leafText(leaf.value), '1.2', ''), doc, '      ', '  ', '\n')}\n`).join('')
          return `<?xml version="1.0" encoding="UTF-8" ?>\n<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n  <file target-language="${escapeXmlAttribute(ctx.locale)}" datatype="plaintext" original="ng2.template">\n    <body>\n${units}    </body>\n  </file>\n</xliff>\n`
        },
      },
    ],
  }
}

export default xliff
