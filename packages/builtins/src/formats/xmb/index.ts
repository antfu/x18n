import type { MessageOp, MessageTree, NodeRange, Plugin, TextRange } from '@x18n/core'
import type { XmlElement } from '../shared/xml'
import { diffText, errors, pathId, walkLeaves } from '@x18n/core'
import { detectEol, leafText, splice } from '../shared'
import { decodeXml, escapeXmlAttribute, escapeXmlText, indentAt, xmlAttribute, xmlElements, xmlLine } from '../shared/xml'

interface Message {
  readonly id: string
  readonly idRange: TextRange
  readonly element: XmlElement
  /** The message content, after the `<source>` location elements of an `.xmb`. */
  readonly body: TextRange
  /** The `desc` and `meaning` attributes of an `.xmb` message, joined. */
  readonly description: string | undefined
}

interface Bundle {
  /** `.xtb` translations in `<translationbundle>`; otherwise the `.xmb` source in `<messagebundle>`. */
  readonly translations: boolean
  readonly messages: Message[]
}

function descriptionOf(attributes: string): string | undefined {
  const desc = xmlAttribute(attributes, 'desc')?.value.trim()
  const meaning = xmlAttribute(attributes, 'meaning')?.value.trim()
  const notes = [
    desc,
    meaning && `Meaning: ${meaning}`,
  ].filter(Boolean)
  return notes.length > 0
    ? notes.join('\n')
    : undefined
}

function read(text: string): Bundle {
  const translations = /<translationbundle\b/.test(text)
  const messages: Message[] = []
  for (const element of xmlElements(text, translations ? 'translation' : 'msg')) {
    const id = xmlAttribute(element.attributes, 'id')
    if (!id)
      continue
    const attributesAt = element.range.start + text.slice(element.range.start).indexOf(element.attributes)
    let bodyStart = element.inner.start
    for (const source of xmlElements(text, 'source', element.inner.start, element.inner.end))
      bodyStart = Math.max(bodyStart, source.range.end)
    messages.push({
      id: id.value,
      idRange: { start: attributesAt + id.range.start, end: attributesAt + id.range.end },
      element,
      body: { start: bodyStart, end: element.inner.end },
      description: descriptionOf(element.attributes),
    })
  }
  return { translations, messages }
}

const placeholder = /<ph\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>[\s\S]*?<\/ph\s*>)/g

/** Message text of XMB content: `<ph name>` reads as `{$NAME}`. */
function toMessage(content: string): string {
  let out = ''
  let last = 0
  for (const match of content.matchAll(placeholder)) {
    out += decodeXml(content.slice(last, match.index))
    last = match.index + match[0].length
    const name = xmlAttribute(match[1]!, 'name')?.value
    if (name)
      out += `{$${name}}`
  }
  return out + decodeXml(content.slice(last))
}

/** XMB content of a message: `.xmb` keeps the `<ph>` markup it had, with its `<ex>` example; `.xtb` uses `<ph name/>`. */
function toContent(message: string, previous: string, translations: boolean): string {
  const known = new Map<string, string>()
  if (!translations) {
    for (const match of previous.matchAll(placeholder)) {
      const name = xmlAttribute(match[1]!, 'name')?.value
      if (name)
        known.set(name, match[0])
    }
  }
  let out = ''
  let last = 0
  for (const match of message.matchAll(/\{\$([\w-]+)\}/g)) {
    out += escapeXmlText(message.slice(last, match.index))
    last = match.index + match[0].length
    out += known.get(match[1]!) ?? `<ph name="${escapeXmlAttribute(match[1]!)}"/>`
  }
  return out + escapeXmlText(message.slice(last))
}

function element(id: string, content: string, translations: boolean): string {
  return translations
    ? `<translation id="${escapeXmlAttribute(id)}">${content}</translation>`
    : `<msg id="${escapeXmlAttribute(id)}">${content}</msg>`
}

function applyOp(text: string, op: MessageOp, path: string): string {
  const id = op.path.join('.')
  const bundle = read(text)
  const message = bundle.messages.findLast(m => m.id === id)
  if (op.type === 'delete') {
    return message
      ? splice(text, xmlLine(text, message.element.range), '')
      : text
  }
  const eol = detectEol(text)
  if (message) {
    const content = toContent(leafText(op.value), text.slice(message.body.start, message.body.end), bundle.translations).replace(/\n/g, eol)
    return message.element.selfClosing
      ? splice(text, message.element.range, element(id, content, bundle.translations))
      : splice(text, message.body, content)
  }
  const root = bundle.translations
    ? '</translationbundle>'
    : '</messagebundle>'
  const closing = text.lastIndexOf(root)
  if (closing === -1)
    throw errors.X18N2002({ path, reason: `missing ${root}` })
  const previous = bundle.messages.at(-1)
  const indent = previous
    ? indentAt(text, previous.element.range.start)
    : '  '
  let at = closing
  while (text[at - 1] === ' ' || text[at - 1] === '\t')
    at--
  const lead = text[at - 1] === '\n'
    ? ''
    : eol
  const content = toContent(leafText(op.value), '', bundle.translations).replace(/\n/g, eol)
  return splice(text, { start: at, end: at }, `${lead}${indent}${element(id, content, bundle.translations)}${eol}`)
}

/** Angular's XMB source files and the XTB files that hold their translations. */
export function xmb(): Plugin {
  return {
    name: 'x18n:format-xmb',
    formats: [
      {
        id: 'xmb',
        extensions: ['xmb', 'xtb'],
        parse(text) {
          const tree: Record<string, string> = {}
          const ranges = new Map<string, NodeRange>()
          const descriptions = new Map<string, string>()
          for (const message of read(text).messages) {
            tree[message.id] = toMessage(text.slice(message.body.start, message.body.end))
            ranges.set(pathId([message.id]), { key: message.idRange, value: message.body })
            if (message.description)
              descriptions.set(pathId([message.id]), message.description)
          }
          return { tree, ranges, descriptions }
        },
        edit(text, ops, ctx) {
          let next = text
          for (const op of ops)
            next = applyOp(next, op, ctx.path)
          return diffText(text, next)
        },
        serialize: (tree: MessageTree, ctx) => {
          const translations = !ctx.path.endsWith('.xmb')
          const items = [
            ...walkLeaves(tree),
          ].map(leaf => `  ${element(leaf.path.join('.'), toContent(leafText(leaf.value), '', translations), translations)}\n`).join('')
          return translations
            ? `<?xml version="1.0" encoding="UTF-8" ?>\n<!DOCTYPE translationbundle>\n<translationbundle lang="${escapeXmlAttribute(ctx.locale)}">\n${items}</translationbundle>\n`
            : `<?xml version="1.0" encoding="UTF-8" ?>\n<messagebundle handler="angular">\n${items}</messagebundle>\n`
        },
      },
    ],
  }
}

export default xmb
