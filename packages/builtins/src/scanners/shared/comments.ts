import type { SourceFile, TextRange } from '@x18n/core'
import type { Comment, Node, Program } from 'oxc-parser'
import js from '../js/entry'

/** Comment ranges the `js` scanner found while parsing a file, so the `regex` scanner does not parse it again. */
const remembered = new WeakMap<SourceFile, readonly TextRange[]>()

/**
 * The `<!-- -->` comments of markup between `from` and `to`. An unclosed `<!--` runs to `to`, as in the template
 * parser.
 */
function htmlCommentRanges(text: string, from = 0, to: number = text.length): TextRange[] {
  const out: TextRange[] = []
  let at = text.indexOf('<!--', from)
  while (at !== -1 && at < to) {
    const close = text.indexOf('-->', at + 4)
    const end = close === -1 || close + 3 > to
      ? to
      : close + 3
    out.push({ start: at, end })
    at = text.indexOf('<!--', end)
  }
  return out
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string' && 'start' in value
}

/** String and template literals that hold one of `offsets`: inline templates with an HTML comment. */
function literalsAt(program: Program, offsets: readonly number[]): Node[] {
  const out: Node[] = []
  // No pruning by range: a decorator lies before the `export` that holds it.
  const visit = (node: Node): void => {
    const isLiteral = (node.type === 'Literal' && typeof node.value === 'string') || node.type === 'TemplateLiteral'
    if (isLiteral && offsets.some(offset => offset > node.start && offset < node.end))
      out.push(node)
    for (const [key, child] of Object.entries(node)) {
      if (key === 'parent')
        continue
      for (const item of [child].flat()) {
        if (isNode(item))
          visit(item)
      }
    }
  }
  visit(program)
  return out
}

/** Comments of a JS or TS file: those of the parser, and `<!-- -->` inside string and template literals. */
function jsCommentRanges(text: string, program: Program, comments: readonly Comment[]): TextRange[] {
  const ranges: TextRange[] = comments.map(comment => ({ start: comment.start, end: comment.end }))
  const offsets: number[] = []
  for (let at = text.indexOf('<!--'); at !== -1; at = text.indexOf('<!--', at + 4))
    offsets.push(at)
  if (offsets.length > 0) {
    // Inside the quotes; an unclosed `<!--` runs to the end of its literal, not of the file.
    for (const literal of literalsAt(program, offsets))
      ranges.push(...htmlCommentRanges(text, literal.start + 1, literal.end - 1))
  }
  return ranges.sort((a, b) => a.start - b.start)
}

/** Called by the `js` scanner with its parse of `file`. */
export function rememberComments(file: SourceFile, program: Program, comments: readonly Comment[]): void {
  remembered.set(file, jsCommentRanges(file.text, program, comments))
}

/**
 * Comment ranges of a source file, sorted by start, end exclusive: JS and TS comments and the HTML comments of inline
 * templates, or the HTML comments of an `.html` file. Other files have none. A JS or TS file is parsed here only when
 * the `js` scanner has not parsed it already.
 */
export async function commentRanges(file: SourceFile): Promise<readonly TextRange[]> {
  if (file.extension === 'html')
    return htmlCommentRanges(file.text)
  if (!js.extensions.includes(file.extension))
    return []
  const known = remembered.get(file)
  if (known)
    return known
  const { parseSync } = await import('oxc-parser')
  const result = parseSync(file.path, file.text, { sourceType: 'module', range: false })
  return jsCommentRanges(file.text, result.program, result.comments)
}

/** `text` with every range blanked to spaces, line breaks kept, so offsets, lines and columns do not move. */
export function maskRanges(text: string, ranges: readonly TextRange[]): string {
  if (ranges.length === 0)
    return text
  let out = ''
  let last = 0
  for (const range of ranges) {
    const start = Math.max(range.start, last)
    if (range.end <= start)
      continue
    out += text.slice(last, start) + text.slice(start, range.end).replace(/[^\r\n]/g, ' ')
    last = range.end
  }
  return out + text.slice(last)
}
