import { describe, expect, it } from 'vitest'
import { inlineContext, inlineReplacement } from '../src/inline'

function inline(text: string, path: string, call: string, value: string): string | undefined {
  const start = text.indexOf(call)
  if (start === -1)
    throw new Error(`missing ${call}`)
  const expression = { start, end: start + call.length }
  const context = inlineContext(text, path, expression)
  if (!context)
    return undefined
  const replacement = inlineReplacement(value, context)
  return replacement === undefined
    ? undefined
    : text.slice(0, expression.start) + replacement + text.slice(expression.end)
}

describe('inline context and replacement', () => {
  it('replaces a call in JS with a string literal', () => {
    expect(inline('const a = t(\'k\')', 'a.ts', 't(\'k\')', 'Hello')).toBe('const a = "Hello"')
    expect(inline('const a = t(\'k\')', 'a.ts', 't(\'k\')', 'It\'s')).toBe('const a = "It\'s"')
    expect(inline('const a = t(\'k\')', 'a.ts', 't(\'k\')', 'He said "hi"')).toBe('const a = "He said \\"hi\\""')
    expect(inline('const a = t(\'k\')', 'a.ts', 't(\'k\')', 'a\nb')).toBe('const a = "a\\nb"')
  })

  it('replaces a call inside JSX braces and attributes', () => {
    expect(inline('<p>{t(\'k\')}</p>', 'a.tsx', 't(\'k\')', 'Hello')).toBe('<p>{"Hello"}</p>')
    expect(inline('<a title={t(\'k\')}>', 'a.tsx', 't(\'k\')', 'Hello')).toBe('<a title={"Hello"}>')
  })

  it('replaces a call in a Vue interpolation', () => {
    expect(inline('<p>{{ $t(\'k\') }}</p>', 'a.vue', '$t(\'k\')', 'Hello')).toBe('<p>{{ "Hello" }}</p>')
    expect(inline('<p>{{ $t(\'k\') }}</p>', 'a.vue', '$t(\'k\')', 'a }} b')).toBeUndefined()
  })

  it('escapes a quoted attribute with the other JS quote and entities', () => {
    expect(inline('<p :title="$t(\'k\')">', 'a.vue', '$t(\'k\')', 'It\'s')).toBe('<p :title="\'It\\\'s\'">')
    expect(inline('<p :title="$t(\'k\')">', 'a.vue', '$t(\'k\')', 'He said "hi"')).toBe('<p :title="\'He said &quot;hi&quot;\'">')
    expect(inline('<p :title="$t(\'k\')">', 'a.vue', '$t(\'k\')', 'Tom & Jerry')).toBe('<p :title="\'Tom &amp; Jerry\'">')
    expect(inline('<p :title=\'$t("k")\'>', 'a.vue', '$t("k")', 'It\'s')).toBe('<p :title=\'"It&#39;s"\'>')
    expect(inline('<p title="{$t(\'k\')}">', 'a.svelte', '$t(\'k\')', 'It\'s')).toBe('<p title="{\'It\\\'s\'}">')
    expect(inline('<p :title="$t(\'k\')">', 'a.vue', '$t(\'k\')', 'a\nb\tc')).toBe('<p :title="\'a\\nb\\tc\'">')
  })

  it('skips partial, unquoted and plain template contexts', () => {
    expect(inline('<p :title="$t(\'k\') + \' x\'">', 'a.vue', '$t(\'k\')', 'Hello')).toBeUndefined()
    expect(inline('<p :title=$t(\'k\')>', 'a.vue', '$t(\'k\')', 'Hello')).toBeUndefined()
    expect(inline('<p>$t(\'k\')</p>', 'a.vue', '$t(\'k\')', 'Hello')).toBeUndefined()
    expect(inline('<p>{{ cond ? $t(\'a\') : $t(\'b\') }}</p>', 'a.vue', '$t(\'a\')', 'A')).toBeUndefined()
    expect(inline('<p>{cond ? t(\'a\') : t(\'b\')}</p>', 'a.tsx', 't(\'a\')', 'A')).toBe('<p>{cond ? "A" : t(\'b\')}</p>')
  })

  it('keeps an SFC script from ending early', () => {
    expect(inline('<script>\nt(\'k\')\n</script>', 'a.vue', 't(\'k\')', 'Hello')).toBe('<script>\n"Hello"\n</script>')
    expect(inline('<script>\nt(\'k\')\n</script>', 'a.vue', 't(\'k\')', '</script>')).toBeUndefined()
    expect(inline('---\nt(\'k\')\n---\n<p />', 'a.astro', 't(\'k\')', '</script>')).toBe('---\n"</script>"\n---\n<p />')
  })
})
