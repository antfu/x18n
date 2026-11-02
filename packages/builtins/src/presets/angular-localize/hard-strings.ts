import type { HardString } from '@x18n/core'
import type { ElementNode, IcuNode, InterpolationNode, TemplateNode, TextNode } from '../../scanners/shared/angular-template'
import type { InlineTemplate } from './messages'
import { codeAttribute, codeElements, parseTemplate } from '../../scanners/shared/angular-template'
import { isTextAttribute } from '../../scanners/shared/js'
import { inlineTemplates, messageText } from './messages'

const letter = /\p{L}/u

/** Attributes that mark the content of an element as translated already, or as never translated (`translate="no"`). */
const translatedContent = new Set(['i18n', 'translate'])

function marked(node: ElementNode): boolean {
  return node.attributes.some(a => translatedContent.has(a.name))
}

/** Angular rejects an `i18n` element inside another one. */
function containsMarked(nodes: readonly TemplateNode[]): boolean {
  return nodes.some((node) => {
    if (node.type === 'element')
      return marked(node) || containsMarked(node.children)
    return node.type === 'block' && containsMarked(node.children)
  })
}

type RunNode = TextNode | InterpolationNode | IcuNode

/** Text with letters, or an ICU with them in a case: what makes a message worth marking. */
function hasLetters(node: TemplateNode): boolean {
  if (node.type === 'text')
    return letter.test(node.value)
  return node.type === 'icu' && node.cases.some(c => c.children.some(hasLetters))
}

class TemplateHardStrings {
  readonly hardStrings: HardString[] = []

  constructor(readonly text: string, readonly textAttributes: readonly string[] | undefined) {}

  nodes(nodes: readonly TemplateNode[], translated: boolean): void {
    let run: RunNode[] = []
    const flush = (): void => {
      if (!translated)
        this.loose(run)
      run = []
    }
    for (const node of nodes) {
      if (node.type === 'text' || node.type === 'interpolation' || node.type === 'icu') {
        run.push(node)
        continue
      }
      flush()
      if (node.type === 'element')
        this.element(node, translated)
      else if (node.type === 'block')
        this.nodes(node.children, translated)
    }
    flush()
  }

  element(node: ElementNode, translated: boolean): void {
    if (codeElements.has(node.name.toLowerCase()))
      return
    this.attributes(node)
    if (translated || marked(node))
      return this.nodes(node.children, true)
    if (!node.children.some(hasLetters) || containsMarked(node.children))
      return this.nodes(node.children, false)
    // The whole element is one message, so that a sentence with a link or `{{ name }}` stays together.
    const start = node.start + 1
    this.hardStrings.push({
      text: messageText(node.children),
      range: { start, end: start + node.name.length },
      kind: 'html-element',
      attribute: node.name,
    })
    this.nodes(node.children, true)
  }

  attributes(node: ElementNode): void {
    const names = new Set(node.attributes.map(a => a.name))
    for (const { name, value, range } of node.attributes) {
      if (codeAttribute.test(name) || names.has(`i18n-${name}`) || value.includes('{{'))
        continue
      if (isTextAttribute(name, this.textAttributes) && letter.test(value)) {
        this.hardStrings.push({
          text: value.trim(),
          range,
          kind: 'html-attribute',
          attribute: name,
        })
      }
    }
  }

  /** Text, interpolations and ICUs with no element of their own, at the top of a template or directly in a block. */
  loose(run: readonly RunNode[]): void {
    if (!run.some(hasLetters))
      return
    const kept = run.filter(node => node.type !== 'text' || node.value.trim())
    const first = kept[0]!
    const last = kept.at(-1)!
    const raw = (node: RunNode): string => this.text.slice(node.start, node.end)
    const trimmed = kept.map((node, i) => node.type !== 'text'
      ? node
      : {
          ...node,
          value: i === 0 && i === kept.length - 1
            ? node.value.trim()
            : i === 0
              ? node.value.trimStart()
              : i === kept.length - 1
                ? node.value.trimEnd()
                : node.value,
        })
    this.hardStrings.push({
      text: messageText(trimmed),
      range: {
        start: first.start + raw(first).length - raw(first).trimStart().length,
        end: last.end - raw(last).length + raw(last).trimEnd().length,
      },
      kind: 'html-text',
    })
  }
}

/**
 * Hard strings of a template, as the markup `@angular/localize` needs. An element with text gets an `i18n` attribute and
 * keeps its content, text with no element goes in an `<ng-container i18n>`, and a text attribute gets an `i18n-*` one.
 */
export function templateHardStrings(template: string, textAttributes?: readonly string[]): HardString[] {
  const scan = new TemplateHardStrings(template, textAttributes)
  scan.nodes(parseTemplate(template), false)
  return scan.hardStrings
}

/** A `template:` is markup when it has a tag, or belongs to a component whose class has not started yet. */
function isComponentTemplate(code: string, template: InlineTemplate): boolean {
  if (template.text.includes('<'))
    return true
  const before = code.slice(0, template.offset)
  const decorator = before.lastIndexOf('@Component')
  return decorator !== -1 && !/\bclass\s/.test(before.slice(decorator))
}

/** Hard strings of `template:` strings in code, with ranges in the code. */
export function inlineHardStrings(code: string, textAttributes?: readonly string[]): HardString[] {
  return inlineTemplates(code)
    .filter(template => isComponentTemplate(code, template))
    .flatMap(template => templateHardStrings(template.text, textAttributes).map(hard => ({
      ...hard,
      range: {
        start: template.at(hard.range.start),
        end: template.at(hard.range.end),
      },
      kind: template.quote === '"'
        ? `dq-${hard.kind}`
        : hard.kind,
    })))
}
