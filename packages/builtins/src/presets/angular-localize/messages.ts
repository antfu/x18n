import type { TextRange } from '@x18n/core'
import type { BlockNode, ElementNode, IcuNode, TemplateNode, TextNode } from '../../scanners/shared/angular-template'
import { parseTemplate } from '../../scanners/shared/angular-template'
import { messageId } from './message-id'

/** A message Angular extracts: its id, and where the source marks it. */
export interface AngularMessage {
  readonly id: string
  /** The `i18n` value, the `$localize` metadata block, or the ICU: what a usage points at. */
  readonly range: TextRange
}

interface Meta {
  readonly meaning: string
  readonly customId: string | undefined
}

/** `meaning|description@@id`, as in `i18n` attributes and `$localize` metadata blocks. */
function parseMeta(value: string): Meta {
  const at = value.indexOf('@@')
  const customId = at === -1
    ? undefined
    : value.slice(at + 2).trim()
  const rest = at === -1
    ? value
    : value.slice(0, at)
  const bar = rest.indexOf('|')
  return {
    meaning: bar === -1
      ? ''
      : rest.slice(0, bar).trim(),
    customId: customId || undefined,
  }
}

// --- Messages ---

const whitespace = ' \\f\\n\\r\\t\\v\\u1680\\u180e\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff'
const notBlank = new RegExp(`[^${whitespace}]`)
const runs = new RegExp(`[${whitespace}]{2,}`, 'g')

const tagNames: Record<string, string> = {
  A: 'LINK',
  B: 'BOLD_TEXT',
  BR: 'LINE_BREAK',
  EM: 'EMPHASISED_TEXT',
  H1: 'HEADING_LEVEL1',
  H2: 'HEADING_LEVEL2',
  H3: 'HEADING_LEVEL3',
  H4: 'HEADING_LEVEL4',
  H5: 'HEADING_LEVEL5',
  H6: 'HEADING_LEVEL6',
  HR: 'HORIZONTAL_RULE',
  I: 'ITALIC_TEXT',
  LI: 'LIST_ITEM',
  LINK: 'MEDIA_LINK',
  OL: 'ORDERED_LIST',
  P: 'PARAGRAPH',
  Q: 'QUOTATION',
  S: 'STRIKETHROUGH_TEXT',
  SMALL: 'SMALL_TEXT',
  SUB: 'SUBSTRIPT',
  SUP: 'SUPERSCRIPT',
  TBODY: 'TABLE_BODY',
  TD: 'TABLE_CELL',
  TFOOT: 'TABLE_FOOTER',
  TH: 'TABLE_HEADER_CELL',
  THEAD: 'TABLE_HEADER',
  TR: 'TABLE_ROW',
  TT: 'MONOSPACED_TEXT',
  U: 'UNDERLINED_TEXT',
  UL: 'UNORDERED_LIST',
}

const isI18nAttribute = (name: string): boolean => name === 'i18n' || name.startsWith('i18n-')

/** Placeholder names, unique per message: the same tag or expression keeps its name, a different one counts up. */
class Placeholders {
  private readonly counts = new Map<string, number>()
  private readonly names = new Map<string, string>()

  unique(base: string): string {
    const count = this.counts.get(base)
    this.counts.set(base, (count ?? 0) + 1)
    return count === undefined
      ? base
      : `${base}_${count}`
  }

  named(signature: string, base: string): string {
    let name = this.names.get(signature)
    if (!name) {
      name = this.unique(base)
      this.names.set(signature, name)
    }
    return name
  }

  tag(element: ElementNode): [string, string] {
    const attributes = Object.fromEntries(element.attributes.filter(a => !isI18nAttribute(a.name)).map(a => [a.name, a.value]))
    const listed = Object.keys(attributes).sort().map(name => ` ${name}=${attributes[name]}`).join('')
    // Angular names these `:svg:path`, so the placeholder is `TAG__SVG_PATH` and never one of the HTML names.
    const name = element.namespace
      ? `:${element.namespace}:${element.name}`
      : element.name
    const base = (element.namespace
      ? undefined
      : tagNames[name.toUpperCase()]) ?? `TAG_${name.toUpperCase()}`
    const start = this.named(`<${name}${listed}${element.isVoid
      ? '/>'
      : `></${name}>`}`, element.isVoid
      ? base
      : `START_${base}`)
    const close = element.isVoid
      ? ''
      : this.named(`</${name}></${name}>`, `CLOSE_${base}`)
    return [start, close]
  }

  block(block: BlockNode): [string, string] {
    const snake = block.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')
    const parameters = block.parameters.length
      ? ` (${[...block.parameters].sort().join('; ')})`
      : ''
    return [
      this.named(`@${block.name}${parameters} {}`, `START_BLOCK_${snake}`),
      this.named(`@close_${block.name} {}`, `CLOSE_BLOCK_${snake}`),
    ]
  }

  interpolation(expression: string): string {
    const custom = /\/\/.*?\bi18n\s*\(\s*ph\s*=\s*(["'])([^"']*)\1\s*\)/s.exec(expression)?.[2]
    const base = (custom || 'INTERPOLATION').toUpperCase()
    return this.named(`PH: ${base}=${expression}`, base)
  }
}

/** Text as Angular keeps it in a message: whitespace-only text goes unless an ICU is next to it, runs collapse to one space. */
function keptText(nodes: readonly TemplateNode[], index: number): string | undefined {
  const node = nodes[index] as TextNode
  const icuSibling = nodes[index - 1]?.type === 'icu' || nodes[index + 1]?.type === 'icu'
  if (!notBlank.test(node.value) && !icuSibling)
    return undefined
  return node.value.replace(//g, ' ').replace(runs, ' ')
}

interface Built {
  readonly text: string
  /** ICUs inside the message, each a message of its own. */
  readonly icus: IcuNode[]
}

class MessageBuilder {
  readonly placeholders = new Placeholders()
  readonly icus: IcuNode[] = []

  /** The `$localize` form: placeholders as `{$NAME}`; a message that is one ICU is the ICU itself. */
  message(nodes: readonly TemplateNode[]): string {
    const kept = nodes.filter((node, i) => node.type !== 'text' || keptText(nodes, i) !== undefined)
    const only = kept.length === 1
      ? kept[0]
      : undefined
    if (only?.type === 'icu')
      return this.icu(only)
    return this.nodes(nodes, false)
  }

  private nodes(nodes: readonly TemplateNode[], inIcu: boolean): string {
    let out = ''
    nodes.forEach((node, i) => {
      out += this.node(nodes, i, inIcu)
    })
    return out
  }

  private ph(name: string, inIcu: boolean): string {
    // The public name: `TAG_NG-CONTAINER` is written `TAG_NG_CONTAINER`.
    const shown = name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    return inIcu
      ? `{${shown}}`
      : `{$${shown}}`
  }

  private node(nodes: readonly TemplateNode[], index: number, inIcu: boolean): string {
    const node = nodes[index]!
    switch (node.type) {
      case 'text':
        // Inside an ICU, Angular keeps the text as written.
        return inIcu
          ? node.value
          : keptText(nodes, index) ?? ''
      case 'interpolation':
        return this.ph(this.placeholders.interpolation(node.expression), inIcu)
      case 'element': {
        const children = this.nodes(node.children, inIcu)
        const [start, close] = this.placeholders.tag(node)
        return node.isVoid
          ? this.ph(start, inIcu)
          : `${this.ph(start, inIcu)}${children}${this.ph(close, inIcu)}`
      }
      case 'block': {
        const children = this.nodes(node.children, inIcu)
        if (node.name === 'switch')
          return children
        const [start, close] = this.placeholders.block(node)
        return `${this.ph(start, inIcu)}${children}${this.ph(close, inIcu)}`
      }
      case 'icu':
        if (inIcu)
          return this.icu(node)
        this.icus.push(node)
        return this.ph(this.placeholders.named(`PH: ICU=${node.source}`, 'ICU'), false)
    }
  }

  icu(node: IcuNode): string {
    const cases = node.cases.map(c => `${c.key} {${this.nodes(c.children, true)}}`)
    const variable = this.placeholders.unique(`VAR_${node.kind.toUpperCase()}`)
    return `{${variable}, ${node.kind}, ${cases.join(' ')}}`
  }
}

/** A message in Angular's form: text with `{$NAME}` placeholders. */
export function messageText(nodes: readonly TemplateNode[]): string {
  return build(nodes).text
}

function build(nodes: readonly TemplateNode[]): Built {
  const builder = new MessageBuilder()
  return {
    text: builder.message(nodes),
    icus: builder.icus,
  }
}

/** The messages of one i18n part, and those of the ICUs inside it. */
function messagesOf(nodes: readonly TemplateNode[], meta: Meta, range: TextRange, out: AngularMessage[]): void {
  const { text, icus } = build(nodes)
  // Angular extracts nothing for `<p i18n></p>` or `<img i18n-alt alt="">`.
  if (text)
    out.push({ id: meta.customId ?? messageId(text, meta.meaning), range })
  for (const icu of icus) {
    const inner = new MessageBuilder().icu(icu)
    out.push({
      id: messageId(inner),
      range: { start: icu.start, end: icu.end },
    })
  }
}

/** The `{{ }}` parts of an attribute value, as template nodes. */
function attributeNodes(value: string, offset: number): TemplateNode[] {
  return parseTemplate(value).map(node => ({ ...node, start: node.start + offset, end: node.end + offset }))
}

function walk(nodes: readonly TemplateNode[], out: AngularMessage[]): void {
  for (const node of nodes) {
    if (node.type === 'element') {
      for (const attribute of node.attributes) {
        if (!isI18nAttribute(attribute.name))
          continue
        const meta = parseMeta(attribute.value)
        const range = attribute.valueRange ?? attribute.range
        if (attribute.name === 'i18n') {
          messagesOf(node.children, meta, range, out)
          continue
        }
        const target = node.attributes.find(a => a.name === attribute.name.slice('i18n-'.length))
        if (target)
          messagesOf(attributeNodes(target.value, target.valueRange?.start ?? target.range.start), meta, range, out)
      }
      // `i18n-*` attributes inside an `i18n` element are messages of their own.
      walk(node.children, out)
    }
    else if (node.type === 'block') {
      walk(node.children, out)
    }
    else if (node.type === 'icu') {
      for (const c of node.cases)
        walk(c.children, out)
    }
  }
}

/** The messages of an Angular template: `i18n` elements, `i18n-*` attributes and the ICUs inside them. */
export function templateMessages(template: string, offset = 0): AngularMessage[] {
  const out: AngularMessage[] = []
  walk(parseTemplate(template.replace(/\r\n?/g, '\n')), out)
  return offset
    ? out.map(m => ({
        ...m,
        range: { start: m.range.start + offset, end: m.range.end + offset },
      }))
    : out
}

// --- $localize ---

const escapes = /\\(u\{[\da-f]+\}|u[\da-f]{4}|x[\da-f]{2}|\r\n|[\s\S])/gi

function cookEscape(escape: string): string {
  const first = escape[0]!
  if (first === 'u' || first === 'U') {
    const hex = escape[1] === '{'
      ? escape.slice(2, -1)
      : escape.slice(1)
    return String.fromCodePoint(Number.parseInt(hex, 16))
  }
  if (first === 'x' || first === 'X')
    return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
  return ({
    n: '\n',
    r: '\r',
    t: '\t',
    b: '\b',
    f: '\f',
    v: '\v',
    0: '\0',
  } as Record<string, string>)[escape] ?? (escape.startsWith('\r') || escape === '\n'
    ? ''
    : escape)
}

function cook(raw: string): string {
  return raw.replace(escapes, (_, escape: string) => cookEscape(escape))
}

/** Cooks a string, and maps each offset of the result back to the source. */
function cookMapped(raw: string, offset: number): { readonly text: string, readonly at: (index: number) => number } {
  let text = ''
  const map: number[] = []
  const copy = (end: number, from: number): void => {
    for (let i = from; i < end; i++) {
      text += raw[i]
      map.push(offset + i)
    }
  }
  let last = 0
  for (const match of raw.matchAll(escapes)) {
    copy(match.index, last)
    const cooked = cookEscape(match[1]!)
    for (let i = 0; i < cooked.length; i++)
      map.push(offset + match.index)
    text += cooked
    last = match.index + match[0].length
  }
  copy(raw.length, last)
  map.push(offset + raw.length)
  return {
    text,
    at: index => map[index] ?? offset + raw.length,
  }
}

/** Where the `${...}` expression whose body starts at `start` ends, after its `}`. */
function expressionEnd(text: string, start: number): number | undefined {
  let depth = 1
  let i = start
  while (i < text.length && depth > 0) {
    const char = text[i]!
    if (char === '`') {
      const inner = templateParts(text, i)
      if (!inner)
        return undefined
      i = inner.end
      continue
    }
    if (char === '\'' || char === '"') {
      const close = text.indexOf(char, i + 1)
      i = close === -1
        ? text.length
        : close + 1
      continue
    }
    if (char === '{')
      depth++
    else if (char === '}')
      depth--
    i++
  }
  return i
}

/** The raw parts of the template literal starting at `start` (the backtick), and where it ends. */
function templateParts(text: string, start: number): { parts: string[], end: number } | undefined {
  const parts: string[] = []
  let part = ''
  let i = start + 1
  while (i < text.length) {
    const char = text[i]!
    if (char === '`') {
      parts.push(part)
      return { parts, end: i + 1 }
    }
    if (char === '$' && text[i + 1] === '{') {
      parts.push(part)
      part = ''
      const end = expressionEnd(text, i + 2)
      if (end === undefined)
        return undefined
      i = end
      continue
    }
    const length = char === '\\'
      ? 2
      : 1
    part += text.slice(i, i + length)
    i += length
  }
  return undefined
}

/** Messages of `$localize` tagged templates: `:meaning|description@@id:` metadata and `:name:` placeholder names. */
export function localizeMessages(code: string): AngularMessage[] {
  const out: AngularMessage[] = []
  for (const match of code.matchAll(/\$localize\s*`/g)) {
    const tick = match.index + match[0].length - 1
    const literal = templateParts(code, tick)
    if (!literal)
      continue
    const cooked = literal.parts.map(cook)
    let meta: Meta = { meaning: '', customId: undefined }
    let metaRange: TextRange = { start: match.index, end: tick + 1 }
    const head = /^:((?:[^:\\]|\\.)*):/.exec(cooked[0]!)
    if (head) {
      meta = parseMeta(head[1]!.split('␟')[0]!)
      cooked[0] = cooked[0]!.slice(head[0].length)
      metaRange = { start: tick + 1, end: tick + 1 + head[0].length }
    }
    let message = cooked[0]!
    for (let i = 1; i < cooked.length; i++) {
      const named = /^:([^:]*):/.exec(cooked[i]!)
      const name = named?.[1]?.split('␟')[0] || (i === 1
        ? 'PH'
        : `PH_${i - 1}`)
      message += `{$${name}}${named
        ? cooked[i]!.slice(named[0].length)
        : cooked[i]}`
    }
    out.push({ id: meta.customId ?? messageId(message, meta.meaning), range: metaRange })
  }
  return out
}

/** Inline `template:` strings of components in a TS file, with their offsets. */
export interface InlineTemplate {
  readonly text: string
  readonly offset: number
  readonly quote: string
  /** The offset in the code of an offset in `text`, which differ after an escape. */
  readonly at: (index: number) => number
}

export function inlineTemplates(code: string): InlineTemplate[] {
  const out: InlineTemplate[] = []
  for (const match of code.matchAll(/\btemplate\s*:\s*([`'"])/g)) {
    const quote = match[1]!
    const start = match.index + match[0].length
    let raw: string | undefined
    if (quote === '`') {
      const literal = templateParts(code, start - 1)
      if (literal?.parts.length === 1)
        raw = literal.parts[0]!
    }
    else {
      let end = start
      while (end < code.length && code[end] !== quote && code[end] !== '\n') {
        end += code[end] === '\\'
          ? 2
          : 1
      }
      if (code[end] === quote)
        raw = code.slice(start, end)
    }
    if (raw !== undefined) {
      out.push({
        ...cookMapped(raw, start),
        offset: start,
        quote,
      })
    }
  }
  return out
}
