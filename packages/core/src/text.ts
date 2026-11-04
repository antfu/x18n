import type { TextEdit, TextRange } from './types/model'

/** One edit covering only the part that differs, so bytes outside it stay the same. */
export function diffText(before: string, after: string): TextEdit[] {
  if (before === after)
    return []
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start))
    start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--
    endAfter--
  }
  return [
    {
      range: { start, end: endBefore },
      text: after.slice(start, endAfter),
    },
  ]
}

/** Applies non-overlapping edits given against the same text. */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.range.start - a.range.start || b.range.end - a.range.end)
  let out = text
  for (const edit of sorted)
    out = out.slice(0, edit.range.start) + edit.text + out.slice(edit.range.end)
  return out
}

export interface LinePosition {
  /** Zero-based. */
  readonly line: number
  /** Zero-based, UTF-16 code units. */
  readonly character: number
}

/** Converts offsets to lines and back for one text. */
export interface LineIndex {
  readonly position: (offset: number) => LinePosition
  readonly offset: (position: LinePosition) => number
  readonly line: (line: number) => string
  readonly lineCount: number
}

const lineIndexes = new Map<string, LineIndex>()

/**
 * Line index of a text, cached for the few texts used at a time (reporters, LSP ranges).
 * The least recently used text goes first, so a large resource hit by many diagnostics stays
 * cached while ranges in many small source files pass through.
 */
export function createLineIndex(text: string): LineIndex {
  let index = lineIndexes.get(text)
  if (index) {
    lineIndexes.delete(text)
  }
  else {
    if (lineIndexes.size >= 16)
      lineIndexes.delete(lineIndexes.keys().next().value!)
    index = buildLineIndex(text)
  }
  lineIndexes.set(text, index)
  return index
}

function buildLineIndex(text: string): LineIndex {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10)
      starts.push(i + 1)
  }
  return {
    lineCount: starts.length,
    position(offset) {
      let low = 0
      let high = starts.length - 1
      while (low < high) {
        const mid = (low + high + 1) >> 1
        if (starts[mid]! <= offset)
          low = mid
        else
          high = mid - 1
      }
      return { line: low, character: offset - starts[low]! }
    },
    offset(position) {
      const start = starts[Math.min(position.line, starts.length - 1)] ?? 0
      return Math.min(start + position.character, text.length)
    },
    line(line) {
      const start = starts[line] ?? text.length
      const end = starts[line + 1] ?? text.length
      return text.slice(start, end).replace(/\r?\n$/, '')
    },
  }
}

export function rangeContains(range: TextRange, offset: number): boolean {
  return offset >= range.start && offset <= range.end
}

/** Fast non-cryptographic string hash (cyrb53), as hex. */
export function hashText(text: string): string {
  let h1 = 0xDEADBEEF
  let h2 = 0x41C6CE57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}
