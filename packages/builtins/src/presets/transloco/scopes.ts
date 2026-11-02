import type { Plugin, Scanner, Scope } from '@x18n/core'
import type { TemplateNode } from '../../scanners/shared/angular-template'
import { parseTemplate } from '../../scanners/shared/angular-template'
import { inlineTemplates } from '../angular-localize/messages'

/** The prefix of an element: `*transloco="let t; prefix: 'a'"`, or `<ng-template transloco let-t prefix="a">`. `read` is its older name. */
function prefixOf(attributes: readonly { readonly name: string, readonly value: string }[]): string | undefined {
  const structural = attributes.find(a => a.name === '*transloco')
  if (structural)
    return /\b(?:prefix|read)\s*:\s*['"]([^'"]+)['"]/.exec(structural.value)?.[1]
  return attributes.some(a => a.name === 'transloco')
    ? attributes.find(a => a.name === 'prefix' || a.name === 'read')?.value
    : undefined
}

/** Each `t('key')` under a prefix, by where its key starts. Nested elements come later, so the nearest prefix wins. */
function collect(nodes: readonly TemplateNode[], template: string, found: Map<number, Scope>): void {
  for (const node of nodes) {
    if (node.type === 'block') {
      collect(node.children, template, found)
    }
    else if (node.type === 'element') {
      const prefix = prefixOf(node.attributes)
      if (prefix) {
        const text = template.slice(node.start, node.end)
        for (const match of text.matchAll(/(?<![\w.])t\(\s*['"`]([^'"`]*)/g)) {
          const end = node.start + match.index + match[0].length
          found.set(end, {
            range: { start: end - match[1]!.length, end },
            keyPrefix: prefix,
          })
        }
      }
      collect(node.children, template, found)
    }
  }
}

function scopesOf(template: string): Scope[] {
  const found = new Map<number, Scope>()
  collect(parseTemplate(template), template, found)
  return [
    ...found.values(),
  ]
}

const scanner: Scanner = {
  id: 'transloco-prefix',
  extensions: ['html', 'ts'],
  scan(file) {
    if (file.extension === 'html') {
      return {
        usages: [],
        scopes: scopesOf(file.text),
      }
    }
    return {
      usages: [],
      scopes: inlineTemplates(file.text).flatMap(template => scopesOf(template.text).map(scope => ({
        ...scope,
        range: {
          start: template.at(scope.range.start),
          end: template.at(scope.range.end),
        },
      }))),
    }
  },
}

/** Scopes of the `t` of a structural directive. A pipe in the same element reads its own key, so only `t(...)` gets one. */
export function translocoScopes(): Plugin {
  return {
    name: 'x18n:transloco-prefix',
    scanners: [scanner],
  }
}
