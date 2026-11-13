import type { HardString, Plugin, Scanner, ScanResult, TextRange, UsageCandidate } from '@x18n/core'
import { createScanScope, isTextAttribute, loadParser, scanSource } from '../shared/js'

type SvelteCompiler = typeof import('svelte/compiler')
let compiler: Promise<SvelteCompiler> | undefined

interface SvelteNode {
  readonly type: string
  readonly start: number
  readonly end: number
}

function isSvelteNode(value: unknown): value is SvelteNode {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string' && 'start' in value && typeof value.start === 'number' && 'end' in value && typeof value.end === 'number'
}

const expressionTypes = new Set([
  'ExpressionTag',
  'HtmlTag',
  'ConstTag',
  'RenderTag',
  'IfBlock',
  'EachBlock',
  'AwaitBlock',
  'KeyBlock',
])

function textHardString(node: SvelteNode, data: string, attribute: SvelteNode & { name?: unknown } | undefined, textAttributes: readonly string[] | undefined, out: HardString[]): void {
  const text = data.trim()
  if (!text || !/\p{L}/u.test(text))
    return
  if (attribute) {
    if (typeof attribute.name === 'string' && isTextAttribute(attribute.name, textAttributes)) {
      // The whole attribute, which templates such as `{attr}={$_('{key}')}` replace.
      out.push({
        text,
        range: { start: attribute.start, end: attribute.end },
        kind: 'svelte-attribute',
        attribute: attribute.name,
      })
    }
    return
  }
  const start = node.start + data.indexOf(text)
  out.push({
    text,
    range: { start, end: start + text.length },
    kind: 'svelte-text',
  })
}

/** Svelte components: `<script>` and template expressions through the `js` scanner. Node only at first. */
export function svelte(): Plugin {
  const scanner: Scanner = {
    id: 'svelte',
    extensions: ['svelte'],
    runtime: 'node',
    async scan(file, ctx) {
      compiler ??= import('svelte/compiler')
      const [{ parse }, parseJs] = await Promise.all([
        compiler,
        loadParser(),
      ])
      const usages: UsageCandidate[] = []
      const keySlots: TextRange[] = []
      const hardStrings: HardString[] = []
      const add = (result: ScanResult): void => {
        usages.push(...result.usages)
        keySlots.push(...result.keySlots ?? [])
        hardStrings.push(...result.hardStrings ?? [])
      }
      const ast: unknown = parse(file.text, { modern: true })
      // Scripts first, so template expressions see what they import and declare (`const tr = get(_)`).
      const scope = createScanScope()
      const scan = (text: string, offset: number, expression: boolean): void => {
        try {
          add(scanSource(parseJs, text, {
            calls: ctx.calls,
            offset,
            filename: 'component.ts',
            expression,
            hardStrings: !expression,
            scope,
          }))
        }
        catch {}
      }
      const visit = (node: unknown, parentType: string, attribute: SvelteNode | undefined): void => {
        if (Array.isArray(node)) {
          node.forEach(child => visit(child, parentType, attribute))
          return
        }
        if (typeof node !== 'object' || node === null)
          return
        if (!isSvelteNode(node)) {
          // `Fragment` and `Root` have no positions; walk through them.
          for (const child of Object.values(node))
            visit(child, parentType, attribute)
          return
        }
        if (node.type === 'Script')
          return
        if (expressionTypes.has(node.type) && 'expression' in node && isSvelteNode(node.expression))
          scan(file.text.slice(node.expression.start, node.expression.end), node.expression.start, true)
        if (node.type === 'Text' && 'data' in node && typeof node.data === 'string') {
          textHardString(node, node.data, parentType === 'Attribute'
            ? attribute
            : undefined, ctx.config.extract.attributes, hardStrings)
        }
        const owner = node.type === 'Attribute'
          ? node
          : attribute
        for (const [key, child] of Object.entries(node)) {
          if (key !== 'expression' && typeof child === 'object')
            visit(child, node.type, owner)
        }
      }
      const scripts: SvelteNode[] = []
      if (typeof ast === 'object' && ast !== null) {
        for (const key of ['module', 'instance']) {
          const script: unknown = Reflect.get(ast, key)
          if (isSvelteNode(script) && 'content' in script && isSvelteNode(script.content))
            scripts.push(script.content)
        }
      }
      for (const content of scripts.sort((a, b) => a.start - b.start))
        scan(file.text.slice(content.start, content.end), content.start, false)
      visit(ast, '', undefined)
      return { usages, keySlots, hardStrings }
    },
  }
  return {
    name: 'x18n:scanner-svelte',
    runtime: 'node',
    scanners: [scanner],
  }
}

export default svelte
