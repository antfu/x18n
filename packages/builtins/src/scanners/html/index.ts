import type { HardString, Plugin, Scanner } from '@x18n/core'
import type { ElementNode, TemplateNode } from '../shared/angular-template'
import { codeAttribute, codeElements, parseTemplate } from '../shared/angular-template'
import { isTextAttribute } from '../shared/js'

/**
 * Attributes that mark the content of an element as translated already: the ngx-translate and transloco directives,
 * Angular's `i18n`, and the HTML `translate` attribute (`translate="no"`).
 */
const translatedContent = new Set([
  'translate',
  '[translate]',
  'transloco',
  '[transloco]',
  'i18n',
])

class HtmlTemplate {
  readonly hardStrings: HardString[] = []

  constructor(readonly text: string, readonly textAttributes: readonly string[] | undefined) {}

  nodes(nodes: readonly TemplateNode[], translated: boolean): void {
    for (const node of nodes)
      this.node(node, translated)
  }

  node(node: TemplateNode, translated: boolean): void {
    if (node.type === 'text' && !translated)
      this.textNode(node.value, node.start, node.end)
    // `@if`, `@for`, `@switch`, `@case`, `@defer`, ...: their parameters are code, their content is template.
    else if (node.type === 'block')
      this.nodes(node.children, translated)
    else if (node.type === 'element')
      this.element(node, translated)
    // `{{ expression }}` is code, and an ICU (`{count, plural, ...}`) is a message already.
  }

  element(node: ElementNode, translated: boolean): void {
    const name = node.name.toLowerCase()
    if (codeElements.has(name))
      return
    const names = new Set(node.attributes.map(a => a.name))
    for (const attribute of node.attributes) {
      const { name, value } = attribute
      if (codeAttribute.test(name) || names.has(`i18n-${name}`) || value.includes('{{'))
        continue
      if (isTextAttribute(name, this.textAttributes) && /\p{L}/u.test(value)) {
        // The whole attribute, which templates such as `[{attr}]="'{key}' | translate"` replace.
        this.hardStrings.push({
          text: value.trim(),
          range: attribute.range,
          kind: 'html-attribute',
          attribute: name,
        })
      }
    }
    this.nodes(node.children, translated || node.attributes.some(a => translatedContent.has(a.name)))
  }

  textNode(value: string, start: number, end: number): void {
    const text = value.trim()
    if (!/\p{L}/u.test(text))
      return
    const raw = this.text.slice(start, end)
    const trimmed = raw.trim()
    const at = start + raw.indexOf(trimmed)
    this.hardStrings.push({
      text,
      range: { start: at, end: at + trimmed.length },
      kind: 'html-text',
    })
  }
}

/**
 * Hard strings in HTML and Angular templates: text and text attributes, outside interpolations, bindings,
 * control-flow block parameters, ICUs, `<script>`, `<style>` and elements already marked for translation.
 * Usages in templates come from the presets' `usage.regex` patterns, so this scanner reports none.
 */
export function html(): Plugin {
  const scanner: Scanner = {
    id: 'html',
    extensions: ['html'],
    scan(file, ctx) {
      const template = new HtmlTemplate(file.text, ctx.config.extract.attributes)
      template.nodes(parseTemplate(file.text), false)
      return { usages: [], hardStrings: template.hardStrings }
    },
  }
  return {
    name: 'x18n:scanner-html',
    scanners: [scanner],
  }
}

export default html
