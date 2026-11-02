import type { TextRange } from '@x18n/core'

export interface TextNode { readonly type: 'text', readonly value: string, readonly start: number, readonly end: number }
export interface InterpolationNode { readonly type: 'interpolation', readonly expression: string, readonly start: number, readonly end: number }
interface Attribute { readonly name: string, readonly value: string, readonly valueRange: TextRange | undefined, readonly range: TextRange }
export interface ElementNode { readonly type: 'element', readonly name: string, readonly attributes: Attribute[], readonly children: TemplateNode[], readonly isVoid: boolean, readonly start: number, end: number, namespace?: string }
interface IcuCase { readonly key: string, readonly children: TemplateNode[] }
export interface IcuNode { readonly type: 'icu', readonly switchValue: string, readonly kind: string, readonly cases: IcuCase[], readonly source: string, readonly start: number, readonly end: number }
export interface BlockNode { readonly type: 'block', readonly name: string, readonly parameters: string[], readonly children: TemplateNode[], readonly start: number, end: number }
export type TemplateNode = TextNode | InterpolationNode | ElementNode | IcuNode | BlockNode

/** Elements whose content is code, not text. */
export const codeElements: ReadonlySet<string> = new Set(['script', 'style'])

/**
 * Attributes that hold code or markers rather than text: bindings `[x]`, events `(x)`, structural directives `*x`,
 * references `#x`, animations `@x`, their `bind-`, `on-`, `bindon-` and `let-` forms, and `i18n-*` markers.
 */
export const codeAttribute: RegExp = /^(?:[[(*#@]|bind-|on-|bindon-|let-|i18n)/

const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])
const rawTextElements = new Set(['script', 'style', 'textarea', 'title'])

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
  ngsp: '',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X'
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10)
      return code <= 0x10FFFF
        ? String.fromCodePoint(code)
        : match
    }
    return entities[name] ?? match
  })
}

/** A forgiving parser for the parts of Angular templates that i18n messages are made of. */
class TemplateParser {
  private at = 0

  constructor(private readonly text: string) {}

  parse(): TemplateNode[] {
    return this.nodes(undefined, false)
  }

  /** Nodes until `</closing>`, or until `}` when `inBraces` (a block or an ICU case). */
  private nodes(closing: string | undefined, inBraces: boolean): TemplateNode[] {
    const out: TemplateNode[] = []
    let textStart = this.at
    let text = ''
    while (this.at < this.text.length) {
      const before = this.at
      const found = this.next(closing, inBraces)
      if (found === undefined) {
        if (!text)
          textStart = this.at
        text += this.text[this.at]
        this.at++
        continue
      }
      if (text) {
        out.push({
          type: 'text',
          value: decodeEntities(text),
          start: textStart,
          end: before,
        })
      }
      text = ''
      if (found === 'end')
        return out
      if (found !== 'skip')
        out.push(found)
    }
    if (text) {
      out.push({
        type: 'text',
        value: decodeEntities(text),
        start: textStart,
        end: this.at,
      })
    }
    return out
  }

  /**
   * The construct at the cursor, consumed: a node; `skip` for a comment, a stray closing tag or `@let`;
   * `end` for the closing tag or brace of the parent. Undefined for plain text.
   */
  private next(closing: string | undefined, inBraces: boolean): TemplateNode | 'skip' | 'end' | undefined {
    const at = this.at
    const char = this.text[at]
    if (this.text.startsWith('<!--', at)) {
      const end = this.text.indexOf('-->', at + 4)
      this.at = end === -1
        ? this.text.length
        : end + 3
      return 'skip'
    }
    if (this.text.startsWith('</', at))
      return this.closingTag(closing)
    if (char === '<' && /[a-z]/i.test(this.text[at + 1] ?? ''))
      return this.element()
    if (this.text.startsWith('{{', at))
      return this.interpolation()
    if (char === '{')
      return this.icu() ?? this.reset(at)
    if (char === '@' && /[a-z]/i.test(this.text[at + 1] ?? ''))
      return this.block() ?? this.reset(at)
    if (char === '}' && inBraces) {
      this.at++
      return 'end'
    }
    return undefined
  }

  private reset(at: number): undefined {
    this.at = at
    return undefined
  }

  /** A stray closing tag is skipped, as browsers do. */
  private closingTag(closing: string | undefined): 'skip' | 'end' | undefined {
    const match = /^<\/\s*([^\s>]+)\s*>/.exec(this.text.slice(this.at))
    if (!match)
      return undefined
    this.at += match[0].length
    return closing !== undefined && match[1]!.toLowerCase() === closing.toLowerCase()
      ? 'end'
      : 'skip'
  }

  private interpolation(): InterpolationNode | undefined {
    const end = this.text.indexOf('}}', this.at + 2)
    if (end === -1)
      return undefined
    const node: InterpolationNode = {
      type: 'interpolation',
      expression: this.text.slice(this.at + 2, end),
      start: this.at,
      end: end + 2,
    }
    this.at = end + 2
    return node
  }

  private element(): ElementNode {
    const start = this.at
    const name = /^<([^\s/>]+)/.exec(this.text.slice(this.at))![1]!
    this.at += name.length + 1
    const attributes: Attribute[] = []
    const attribute = /\s*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y
    for (;;) {
      attribute.lastIndex = this.at
      const match = attribute.exec(this.text)
      if (!match)
        break
      const raw = match[2] ?? match[3] ?? match[4]
      const valueStart = raw === undefined
        ? undefined
        : match.index + match[0].length - raw.length - (match[4] === undefined
          ? 1
          : 0)
      attributes.push({
        name: match[1]!,
        value: raw === undefined
          ? ''
          : decodeEntities(raw),
        valueRange: valueStart === undefined
          ? undefined
          : { start: valueStart, end: valueStart + raw!.length },
        range: { start: match.index + match[0].length - match[0].trimStart().length, end: match.index + match[0].length },
      })
      this.at = match.index + match[0].length
    }
    const close = /^\s*(\/?)>/.exec(this.text.slice(this.at))
    const selfClosing = Boolean(close?.[1])
    this.at += close?.[0].length ?? 0
    const lower = name.toLowerCase()
    const isVoid = voidElements.has(lower)
    const node: ElementNode = {
      type: 'element',
      name,
      attributes,
      children: [],
      isVoid,
      start,
      end: this.at,
    }
    if (isVoid || selfClosing)
      return node
    if (rawTextElements.has(lower)) {
      const end = this.text.toLowerCase().indexOf(`</${lower}`, this.at)
      const stop = end === -1
        ? this.text.length
        : end
      if (stop > this.at) {
        node.children.push({
          type: 'text',
          value: decodeEntities(this.text.slice(this.at, stop)),
          start: this.at,
          end: stop,
        })
      }
      this.at = end === -1
        ? stop
        : this.text.indexOf('>', end) + 1
    }
    else {
      node.children.push(...this.nodes(name, false))
    }
    node.end = this.at
    return node
  }

  /** `{switchValue, plural, =0 {...} other {...}}`, or undefined when the brace does not start one. */
  private icu(): IcuNode | undefined {
    const start = this.at
    const head = /^\{([^,{}]*),\s*(\w+)\s*,/.exec(this.text.slice(this.at))
    if (!head)
      return undefined
    this.at += head[0].length
    const cases: IcuCase[] = []
    for (;;) {
      const space = /^\s*/.exec(this.text.slice(this.at))![0]
      this.at += space.length
      if (this.text[this.at] === '}') {
        this.at++
        return {
          type: 'icu',
          switchValue: head[1]!.trim(),
          kind: head[2]!,
          cases,
          source: this.text.slice(start, this.at),
          start,
          end: this.at,
        }
      }
      const key = /^([^\s{}]+)\s*\{/.exec(this.text.slice(this.at))
      if (!key)
        return undefined
      this.at += key[0].length
      cases.push({
        key: key[1]!,
        children: this.nodes(undefined, true),
      })
    }
  }

  /** `@if (a) { ... }`, `@else if (b) {`, `@for (...) {`; `@let` and unknown text are skipped or left as text. */
  private block(): BlockNode | 'skip' | undefined {
    const start = this.at
    const name = /^@([a-z]+(?: if)?)\s*/i.exec(this.text.slice(this.at))
    if (!name)
      return undefined
    if (name[1] === 'let') {
      const end = this.text.indexOf(';', this.at)
      this.at = end === -1
        ? this.text.length
        : end + 1
      return 'skip'
    }
    let at = this.at + name[0].length
    const parameters: string[] = []
    if (this.text[at] === '(') {
      let depth = 0
      let i = at
      for (; i < this.text.length; i++) {
        if (this.text[i] === '(')
          depth++
        else if (this.text[i] === ')' && --depth === 0)
          break
      }
      parameters.push(...this.text.slice(at + 1, i).split(';').map(p => p.trim()).filter(Boolean))
      at = i + 1
    }
    const brace = /^\s*\{/.exec(this.text.slice(at))
    if (!brace)
      return undefined
    this.at = at + brace[0].length
    const node: BlockNode = {
      type: 'block',
      name: name[1]!,
      parameters,
      children: this.nodes(undefined, true),
      start,
      end: 0,
    }
    node.end = this.at
    return node
  }
}

/**
 * Parses an Angular or plain HTML template into text, interpolations, elements, ICUs and control-flow blocks.
 * It never throws: what it cannot read stays text.
 */
export function parseTemplate(text: string): TemplateNode[] {
  const nodes = new TemplateParser(text).parse()
  setNamespaces(nodes, undefined)
  return nodes
}

/** `<svg>` and `<math>` start a namespace their descendants inherit, except inside `<foreignObject>`, which holds HTML. */
function setNamespaces(nodes: readonly TemplateNode[], inherited: string | undefined): void {
  for (const node of nodes) {
    if (node.type === 'element') {
      const name = node.name.toLowerCase()
      const namespace = name === 'svg' || name === 'math'
        ? name
        : inherited
      if (namespace)
        node.namespace = namespace
      setNamespaces(node.children, node.name === 'foreignObject'
        ? undefined
        : namespace)
    }
    else if (node.type === 'block') {
      setNamespaces(node.children, inherited)
    }
    else if (node.type === 'icu') {
      for (const c of node.cases)
        setNamespaces(c.children, inherited)
    }
  }
}
