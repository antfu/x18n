import type { MessageOp, MessageTree, NodeRange, Plugin, TextRange } from '@x18n/core'
import { diffText, errors, pathId, walkLeaves } from '@x18n/core'
import { detectEol, leafText, splice } from '../shared'

interface Entry {
  readonly key: string
  readonly value: string
  readonly range: NodeRange
  /** The entry with the comment right above it, its indent and line break. */
  readonly line: TextRange
  readonly comment: string | undefined
}

function decode(raw: string): string {
  // `\U` takes four hex digits, as `\u`: a character past U+FFFF is two of them, a surrogate pair.
  return raw.replace(/\\(U[\da-f]{4}|[\s\S])/gi, (_, escape: string) => {
    const first = escape[0]!
    if (escape.length > 1)
      return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
    return ({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[first] ?? first
  })
}

const encode = (text: string): string => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')

class Reader {
  at = 0
  /** The comment read last, until an entry takes it. */
  comment: { text: string, start: number, end: number } | undefined

  constructor(readonly text: string, readonly path: string) {}

  fail(reason: string): never {
    throw errors.X18N2002({ path: this.path, reason })
  }

  skip(): void {
    for (;;) {
      while (/\s/.test(this.text[this.at] ?? ''))
        this.at++
      const start = this.at
      if (this.text.startsWith('/*', start)) {
        const end = this.text.indexOf('*/', start + 2)
        if (end === -1)
          this.fail('unclosed comment')
        this.comment = {
          text: this.text.slice(start + 2, end).trim(),
          start,
          end: end + 2,
        }
        this.at = end + 2
      }
      else if (this.text.startsWith('//', start)) {
        const end = this.text.indexOf('\n', start)
        const stop = end === -1
          ? this.text.length
          : end
        this.comment = {
          text: this.text.slice(start + 2, stop).trim(),
          start,
          end: stop,
        }
        this.at = stop
      }
      else {
        return
      }
    }
  }

  /** A quoted or bare string, and the range of its content. */
  token(): { raw: string, range: TextRange } {
    const start = this.at
    if (this.text[start] === '"') {
      let end = start + 1
      while (end < this.text.length && this.text[end] !== '"') {
        end += this.text[end] === '\\'
          ? 2
          : 1
      }
      if (end >= this.text.length)
        this.fail('unclosed string')
      this.at = end + 1
      return {
        raw: this.text.slice(start + 1, end),
        range: { start: start + 1, end },
      }
    }
    const bare = /^[\w.-]+/.exec(this.text.slice(start))?.[0]
    if (!bare)
      this.fail(`unexpected text at offset ${start}`)
    this.at = start + bare.length
    return {
      raw: bare,
      range: { start, end: this.at },
    }
  }

  entries(): Entry[] {
    const out: Entry[] = []
    for (this.skip(); this.at < this.text.length; this.skip()) {
      // A comment is the entry's when it is right above it: a blank line sets it apart, as a file header.
      const comment = this.comment && !/\n[ \t]*\r?\n/.test(this.text.slice(this.comment.end, this.at))
        ? this.comment
        : undefined
      this.comment = undefined
      const key = this.token()
      this.skip()
      if (this.text[this.at] !== '=')
        this.fail(`expected = after "${key.raw}"`)
      this.at++
      this.skip()
      const value = this.token()
      this.skip()
      if (this.text[this.at] !== ';')
        this.fail(`expected ; after "${key.raw}"`)
      this.at++
      this.trailing()
      this.comment = undefined
      out.push({
        key: decode(key.raw),
        value: decode(value.raw),
        range: { key: key.range, value: value.range },
        line: this.lineOf(comment?.start ?? key.range.start - (this.text[key.range.start - 1] === '"'
          ? 1
          : 0), this.at),
        comment: comment?.text,
      })
    }
    return out
  }

  /** A comment after an entry on its line is the entry's, not the next one's. */
  trailing(): void {
    let at = this.at
    while (this.text[at] === ' ' || this.text[at] === '\t')
      at++
    if (this.text.startsWith('//', at)) {
      const end = this.text.indexOf('\n', at)
      this.at = end === -1
        ? this.text.length
        : end
    }
    else if (this.text.startsWith('/*', at)) {
      const end = this.text.indexOf('*/', at + 2)
      if (end !== -1 && !this.text.slice(at, end).includes('\n'))
        this.at = end + 2
    }
  }

  lineOf(from: number, to: number): TextRange {
    let start = from
    while (this.text[start - 1] === ' ' || this.text[start - 1] === '\t')
      start--
    let end = to
    while (this.text[end] === ' ' || this.text[end] === '\t')
      end++
    if (this.text[end] === '\r')
      end++
    if (this.text[end] === '\n')
      end++
    return start === 0 || this.text[start - 1] === '\n'
      ? { start, end }
      : { start: from, end: to }
  }
}

function applyOp(text: string, op: MessageOp, path: string): string {
  const key = op.path.join('.')
  const entry = new Reader(text, path).entries().findLast(e => e.key === key)
  if (op.type === 'delete') {
    return entry
      ? splice(text, entry.line, '')
      : text
  }
  const value = encode(leafText(op.value))
  if (entry) {
    const quoted = text[entry.range.value.start - 1] === '"'
    return splice(text, entry.range.value, quoted
      ? value
      : `"${value}"`)
  }
  const eol = detectEol(text)
  const lead = text.length === 0 || text.endsWith('\n')
    ? ''
    : eol
  return `${text}${lead}"${encode(key)}" = "${value}";${eol}`
}

/** Apple `.strings` files: `"key" = "value";`, with the comment above an entry as its description. */
export function strings(): Plugin {
  return {
    name: 'x18n:format-strings',
    formats: [
      {
        id: 'strings',
        extensions: ['strings'],
        parse(text, ctx) {
          const tree: Record<string, string> = {}
          const ranges = new Map<string, NodeRange>()
          const descriptions = new Map<string, string>()
          for (const entry of new Reader(text, ctx.path).entries()) {
            tree[entry.key] = entry.value
            ranges.set(pathId([entry.key]), entry.range)
            if (entry.comment)
              descriptions.set(pathId([entry.key]), entry.comment)
          }
          return { tree, ranges, descriptions }
        },
        edit(text, ops, ctx) {
          let next = text
          for (const op of ops)
            next = applyOp(next, op, ctx.path)
          return diffText(text, next)
        },
        serialize: (tree: MessageTree) => [
          ...walkLeaves(tree),
        ].map(leaf => `"${encode(leaf.path.join('.'))}" = "${encode(leafText(leaf.value))}";\n`).join(''),
      },
    ],
  }
}

export default strings
