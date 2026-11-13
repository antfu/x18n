import type { TextRange } from '@x18n/core'

/** Where a translate call sits: plain JS, an SFC script, a Vue interpolation or a quoted HTML attribute. */
type InlineContext
  = | { readonly kind: 'js' }
    | { readonly kind: 'script' }
    | { readonly kind: 'interpolation' }
    | { readonly kind: 'attribute', readonly quote: '"' | '\'' }

const jsExtensions = new Set([
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'mts',
  'cts',
])

const templateExtensions = new Set([
  'vue',
  'svelte',
  'astro',
])

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1
    ? ''
    : base.slice(dot + 1).toLowerCase()
}

/** `<script>` contents, and the Astro `---` frontmatter. */
function codeRanges(text: string): { readonly scripts: readonly TextRange[], readonly frontmatter: TextRange | undefined } {
  const scripts: TextRange[] = []
  for (const match of text.matchAll(/<script\b[^>]*>/gi)) {
    const start = match.index + match[0].length
    const close = /<\/script/gi
    close.lastIndex = start
    scripts.push({ start, end: close.exec(text)?.index ?? text.length })
  }
  const open = /^\s*---/.exec(text)
  if (!open)
    return { scripts, frontmatter: undefined }
  const close = /^---/gm
  close.lastIndex = open[0].length
  return {
    scripts,
    frontmatter: { start: open[0].length, end: close.exec(text)?.index ?? text.length },
  }
}

function zoneAt(text: string, path: string, offset: number): 'js' | 'script' | undefined {
  const extension = extensionOf(path)
  if (jsExtensions.has(extension))
    return 'js'
  if (!templateExtensions.has(extension))
    return undefined
  const { scripts, frontmatter } = codeRanges(text)
  // Frontmatter is plain TS: `</script>` in a string there is harmless.
  if (extension === 'astro' && frontmatter && offset >= frontmatter.start && offset <= frontmatter.end)
    return 'js'
  if (scripts.some(range => offset >= range.start && offset <= range.end))
    return 'script'
  return undefined
}

function before(text: string, offset: number): { readonly index: number, readonly char: string } | undefined {
  for (let i = offset - 1; i >= 0; i--) {
    const char = text[i]!
    if (!/\s/.test(char))
      return { index: i, char }
  }
  return undefined
}

function after(text: string, offset: number): { readonly index: number, readonly char: string } | undefined {
  for (let i = offset; i < text.length; i++) {
    const char = text[i]!
    if (!/\s/.test(char))
      return { index: i, char }
  }
  return undefined
}

/**
 * The context of a call, when the call is the whole expression: the content of `{...}` or `{{...}}`,
 * or a quoted attribute value. A call inside a larger expression, an unquoted attribute or plain
 * template text gets no context, so the action is not offered.
 */
export function inlineContext(text: string, path: string, expression: TextRange): InlineContext | undefined {
  const zone = zoneAt(text, path, expression.start)
  if (zone)
    return { kind: zone }
  const prev = before(text, expression.start)
  const next = after(text, expression.end)
  if (!prev || !next)
    return undefined
  if (prev.char === '{' && next.char === '}') {
    const outerBefore = before(text, prev.index)
    const outerAfter = after(text, next.index + 1)
    if (outerBefore && (outerBefore.char === '"' || outerBefore.char === '\'') && outerAfter?.char === outerBefore.char)
      return { kind: 'attribute', quote: outerBefore.char }
    if (outerBefore?.char === '{' && outerAfter?.char === '}')
      return { kind: 'interpolation' }
    return { kind: 'js' }
  }
  if ((prev.char === '"' || prev.char === '\'') && next.char === prev.char)
    return { kind: 'attribute', quote: prev.char }
  return undefined
}

function jsString(value: string): string {
  // JSON escaping covers quotes, backslashes and control characters; U+2028 and U+2029 still end a JS line.
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** A JS string literal inside an HTML attribute: the other quote, entities for `&` and the attribute quote. */
function attributeString(value: string, attributeQuote: '"' | '\''): string {
  const quote = attributeQuote === '"'
    ? '\''
    : '"'
  // Start from JSON's escaping (control characters, backslashes), then use the quote the attribute allows.
  let inner = JSON.stringify(value)
    .slice(1, -1)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  if (quote === '\'')
    inner = inner.replace(/\\"/g, '"').replace(/'/g, '\\\'')
  inner = inner.replace(/&/g, '&amp;')
  const html = attributeQuote === '"'
    ? inner.replace(/"/g, '&quot;')
    : inner.replace(/'/g, '&#39;')
  return `${quote}${html}${quote}`
}

/**
 * The literal that replaces a call, or undefined when the text would break the surrounding syntax.
 * The value comes from `Project.staticText`, which already decoded it and proved it needs no runtime input.
 */
export function inlineReplacement(value: string, context: InlineContext): string | undefined {
  if (context.kind === 'script' && /<\/script/i.test(value))
    return undefined
  if (context.kind === 'interpolation' && /[{}]{2}/.test(value))
    return undefined
  if (context.kind === 'attribute')
    return attributeString(value, context.quote)
  return jsString(value)
}
