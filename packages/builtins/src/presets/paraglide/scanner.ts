import type { Scanner, UsageCandidate } from '@x18n/core'
import { commentRanges, maskRanges } from '../../scanners/shared/comments'
import { scriptExtensions } from '../shared'

// The key is one property name, even when it contains dots, spaces or hyphens.
const calls = /\bm(?:\.([$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*)|\[\s*('(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`)\s*\])\s*\(/dgu

async function literalKey(literal: string): Promise<string | undefined> {
  if (!literal.includes('\\') && !literal.includes('${'))
    return literal.slice(1, -1)
  const { parseSync } = await import('oxc-parser')
  const parsed = parseSync('key.js', `(${literal})`, { preserveParens: false })
  const statement = parsed.program.body[0]
  if (parsed.errors.length || statement?.type !== 'ExpressionStatement')
    return undefined
  const expression = statement.expression
  if (expression.type === 'Literal' && typeof expression.value === 'string')
    return expression.value
  if (expression.type === 'TemplateLiteral' && !expression.expressions.length)
    return expression.quasis[0]?.value.cooked ?? undefined
  return undefined
}

export const paraglideScanner: Scanner = {
  id: 'paraglide',
  extensions: [
    ...scriptExtensions,
    'vue',
    'svelte',
    'astro',
  ],
  async scan(file) {
    const text = maskRanges(file.text, await commentRanges(file))
    const usages: UsageCandidate[] = []
    for (const match of text.matchAll(calls)) {
      const quoted = match[2] !== undefined
      const span = match.indices![quoted ? 2 : 1]!
      // Comment masking preserves offsets but can hide HTML comments inside a JS string.
      const raw = quoted
        ? await literalKey(file.text.slice(...span))
        : match[1]
      if (raw !== undefined) {
        const inset = quoted ? 1 : 0
        usages.push({
          raw,
          range: { start: span[0] + inset, end: span[1] - inset },
          kind: 'call',
          dynamic: false,
        })
      }
    }
    return {
      usages,
      keySlots: usages.map(usage => usage.range),
    }
  },
}
