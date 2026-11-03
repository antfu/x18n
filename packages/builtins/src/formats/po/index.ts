import type { MessageOp, MessageState, MessageTree, NodeRange, Plugin, TextRange } from '@x18n/core'
import { diffText, errors, pathId, walkLeaves } from '@x18n/core'
import { appendLines, detectEol, leafText, splice, splitLines, withBlankLines } from '../shared'

/** gettext joins msgctxt and msgid with EOT. */
const CONTEXT_SEPARATOR = '\u0004'

interface Field {
  readonly name: string
  /** The quoted strings, quotes included. */
  readonly range: { start: number, end: number }
  value: string
}

interface Entry {
  readonly key: string
  readonly value: string
  readonly range: NodeRange
  /** The msgstr (or msgstr[0]) strings, quotes included. */
  readonly source: TextRange
  /** The entry with its comments and separating blank lines. */
  readonly block: TextRange
  /** The extracted (`#.`) and translator (`# `) comments, joined. */
  readonly comment: string | undefined
  /** Flagged `#, fuzzy`: a translation that needs review. */
  readonly fuzzy: boolean
}

const decodings: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
}
const encodings: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\t': '\\t',
  '\r': '\\r',
}

/** Reads one `"..."` string starting at `start`; returns its value and the offset after the closing quote. */
function readString(text: string, start: number, end: number, fail: (message: string) => never): { value: string, end: number } {
  if (text[start] !== '"')
    fail('expected a string')
  let value = ''
  for (let i = start + 1; i < end; i++) {
    const char = text[i]!
    if (char === '"') {
      if (text.slice(i + 1, end).trim() !== '')
        fail('unexpected text after string')
      return { value, end: i + 1 }
    }
    if (char !== '\\') {
      value += char
      continue
    }
    const escape = /^(?:[0-7]{1,3}|x[0-9a-f]{1,2}|[\s\S])/i.exec(text.slice(i + 1, end))?.[0] ?? ''
    value += /^[0-7]/.test(escape)
      ? String.fromCharCode(Number.parseInt(escape, 8))
      : escape.length > 1
        ? String.fromCharCode(Number.parseInt(escape.slice(1), 16))
        : decodings[escape] ?? escape
    i += escape.length
  }
  return fail('unterminated string')
}

interface Draft { start: number, end: number, fields: Field[], comments: string[], fuzzy: boolean }

function toEntry(text: string, draft: Draft, fail: (message: string) => never): Entry | undefined {
  const field = (name: string): Field | undefined => draft.fields.find(f => f.name === name)
  const msgid = field('msgid')
  if (!msgid) {
    return draft.fields.length > 0
      ? fail('entry without msgid')
      : undefined
  }
  const msgctxt = field('msgctxt')
  const msgstr = field('msgstr') ?? field('msgstr[0]')
  if (!msgstr)
    return fail(`msgid "${msgid.value}" without msgstr`)
  // The header entry holds metadata, not a message.
  if (msgid.value === '' && !msgctxt)
    return undefined
  const inner = (f: Field): TextRange => ({ start: f.range.start + 1, end: f.range.end - 1 })
  return {
    key: msgctxt
      ? `${msgctxt.value}${CONTEXT_SEPARATOR}${msgid.value}`
      : msgid.value,
    value: msgstr.value,
    range: {
      key: inner(msgid),
      value: inner(msgstr),
    },
    source: msgstr.range,
    block: withBlankLines(text, { start: draft.start, end: draft.end }),
    comment: draft.comments.join('\n') || undefined,
    fuzzy: draft.fuzzy,
  }
}

function readComment(draft: Draft, content: string): void {
  // `#.` comes from the code, `#` from a translator; `#:`, `#,` and `#|` are references, flags and previous values.
  const comment = /^#\.?(?:\s(.*))?$/.exec(content)?.[1]?.trim()
  if (comment)
    draft.comments.push(comment)
  if (/^#,.*\bfuzzy\b/.test(content))
    draft.fuzzy = true
}

function read(text: string, path: string): Entry[] {
  const entries: Entry[] = []
  let lineNumber = 0
  const fail = (message: string): never => {
    throw errors.X18N2002({ path, line: lineNumber, reason: message })
  }
  let draft: Draft | undefined
  let field: Field | undefined
  const flush = (): void => {
    const entry = draft && toEntry(text, draft, fail)
    if (entry)
      entries.push(entry)
    draft = undefined
    field = undefined
  }
  for (const line of splitLines(text)) {
    lineNumber++
    const offset = line.start + /^\s*/.exec(text.slice(line.start, line.end))![0].length
    const content = text.slice(offset, line.end)
    const keyword = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s*/.exec(content)
    if (content === '' || (content.startsWith('#') && draft?.fields.some(f => f.name.startsWith('msgstr'))))
      flush()
    if (content === '')
      continue
    if (keyword && (keyword[1] === 'msgctxt' || keyword[1] === 'msgid') && draft?.fields.some(f => f.name !== 'msgctxt'))
      flush()
    draft ??= {
      start: line.start,
      end: line.next,
      fields: [],
      comments: [],
      fuzzy: false,
    }
    draft.end = line.next
    if (content.startsWith('#')) {
      readComment(draft, content)
      field = undefined
      continue
    }
    const stringStart = keyword
      ? offset + keyword[0].length
      : offset
    if (!keyword && (!field || !content.startsWith('"')))
      fail(`unexpected "${content.slice(0, 20)}"`)
    const string = readString(text, stringStart, line.end, fail)
    if (keyword) {
      field = {
        name: keyword[1]!,
        range: { start: stringStart, end: string.end },
        value: string.value,
      }
      draft.fields.push(field)
    }
    else {
      field!.range.end = string.end
      field!.value += string.value
    }
  }
  flush()
  return entries
}

const quote = (value: string): string => `"${value.replace(/[\\"\n\t\r]/g, char => encodings[char]!)}"`

/** One string, or gettext's style of an empty first string and one string per line. */
function encode(value: string, eol: string): string {
  if (!value.slice(0, -1).includes('\n'))
    return quote(value)
  return [
    '""',
    ...value.split(/(?<=\n)/).map(quote),
  ].join(eol)
}

function entryText(key: string, value: string): string {
  const index = key.indexOf(CONTEXT_SEPARATOR)
  const context = index === -1
    ? ''
    : `msgctxt ${quote(key.slice(0, index))}\n`
  return `${context}msgid ${encode(key.slice(index + 1), '\n')}\nmsgstr ${encode(value, '\n')}\n`
}

function applyOp(text: string, op: MessageOp, path: string): string {
  const key = op.path.join('.')
  const entry = read(text, path).findLast(e => e.key === key)
  if (op.type === 'delete') {
    return entry
      ? splice(text, entry.block, '')
      : text
  }
  const value = leafText(op.value)
  if (entry)
    return splice(text, entry.source, encode(value, detectEol(text)))
  const separated = text.trim() === '' || /\n[ \t]*\r?\n$/.test(text)
  return appendLines(text, `${separated ? '' : '\n'}${entryText(key, value)}`)
}

export function po(): Plugin {
  return {
    name: 'x18n:format-po',
    formats: [
      {
        id: 'po',
        extensions: ['po', 'pot'],
        parse(text, ctx) {
          const tree: Record<string, string> = {}
          const ranges = new Map<string, NodeRange>()
          const descriptions = new Map<string, string>()
          const states = new Map<string, MessageState>()
          for (const entry of read(text, ctx.path)) {
            tree[entry.key] = entry.value
            ranges.set(pathId([entry.key]), entry.range)
            if (entry.comment)
              descriptions.set(pathId([entry.key]), entry.comment)
            if (entry.fuzzy)
              states.set(pathId([entry.key]), 'needs-review')
          }
          return { tree, ranges, descriptions, states }
        },
        edit(text, ops, ctx) {
          let next = text
          for (const op of ops)
            next = applyOp(next, op, ctx.path)
          return diffText(text, next)
        },
        serialize(tree: MessageTree, ctx) {
          const header = `msgid ""\nmsgstr ""\n"Language: ${ctx.locale}\\n"\n"MIME-Version: 1.0\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Content-Transfer-Encoding: 8bit\\n"\n`
          return [
            header,
            ...[
              ...walkLeaves(tree),
            ].map(leaf => entryText(leaf.path.join('.'), leafText(leaf.value))),
          ].join('\n')
        },
      },
    ],
  }
}

export default po
