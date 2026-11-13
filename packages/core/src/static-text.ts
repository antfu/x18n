import type { Placeholder, TextRange } from './types/model'
import type { MessageLiteral, MessageSyntax, PlaceholderSyntax } from './types/plugin'

/** The text a message renders with no runtime input. */
export interface StaticText {
  readonly value: string
}

export interface StaticTextContext {
  readonly value: string
  readonly syntax: MessageSyntax
  readonly placeholders: readonly PlaceholderSyntax[]
}

/** A value, and how its syntax and its placeholders turn it into the text it renders. */
export interface MessageTextContext extends StaticTextContext {
  /** The text a placeholder reads, or undefined when it stays as written. */
  readonly placeholder?: ((placeholder: Placeholder) => string | undefined) | undefined
}

/** A span of the value that renders as other text. */
interface Piece {
  readonly range: TextRange
  /** What it renders as, or undefined when it stays as written. */
  readonly text: string | undefined
}

/** Literal spans of a value, sorted, or undefined when two of them overlap and the order is unclear. */
function literalSpans(value: string, syntax: MessageSyntax): MessageLiteral[] | undefined {
  const spans = (syntax.literals ?? [])
    .flatMap(literal => literal.find(value))
    .filter(span => span.range.end > span.range.start)
    .sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end)
  let end = 0
  for (const span of spans) {
    if (span.range.start < end)
      return undefined
    end = span.range.end
  }
  return spans
}

function offsetIn(literals: readonly MessageLiteral[], offset: number): boolean {
  return literals.some(literal => offset >= literal.range.start && offset < literal.range.end)
}

/**
 * The spans that render as other text: the literals, and the placeholders outside them, so a
 * placeholder a literal decodes to stays text. Overlapping spans keep the first, and `runtime` says
 * a kept placeholder stayed as written.
 */
function textPieces(value: string, ctx: MessageTextContext, literals: readonly MessageLiteral[]): { readonly pieces: readonly Piece[], readonly runtime: boolean } {
  const found: Piece[] = literals.map(literal => ({ range: literal.range, text: literal.value }))
  for (const syntax of ctx.placeholders) {
    for (const placeholder of syntax.find(value)) {
      if (offsetIn(literals, placeholder.range.start))
        continue
      found.push({
        range: placeholder.range,
        text: ctx.placeholder?.(placeholder),
      })
    }
  }
  found.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end)
  const pieces: Piece[] = []
  for (const piece of found) {
    const last = pieces.at(-1)
    if (last && piece.range.start < last.range.end)
      continue
    pieces.push(piece)
  }
  // A literal always decodes to a string, so only a placeholder can stay undefined.
  return {
    pieces,
    runtime: pieces.some(piece => piece.text === undefined),
  }
}

function render(value: string, pieces: readonly Piece[]): string {
  let out = ''
  let at = 0
  for (const piece of pieces) {
    out += value.slice(at, piece.range.start)
    out += piece.text ?? value.slice(piece.range.start, piece.range.end)
    at = piece.range.end
  }
  return out + value.slice(at)
}

/** A reserved character outside every literal starts syntax whose text is not the character itself. */
function hasReservedOutside(value: string, literals: readonly MessageLiteral[], reserved: string): boolean {
  if (reserved === '')
    return false
  for (let i = 0; i < value.length; i++) {
    if (!offsetIn(literals, i) && reserved.includes(value[i]!))
      return true
  }
  return false
}

/**
 * The text a value renders: its literals decoded, and each placeholder the context resolves replaced.
 * A placeholder the context leaves undefined stays as written, and so does a value with literals that
 * overlap or a placeholder inside one.
 */
export function renderMessageText(ctx: MessageTextContext): string {
  const literals = literalSpans(ctx.value, ctx.syntax)
  return literals === undefined
    ? ctx.value
    : render(ctx.value, textPieces(ctx.value, ctx, literals).pieces)
}

/**
 * The text a value renders, when nothing in it depends on runtime input. A placeholder reads a param,
 * and a reserved character starts syntax whose text is not the character itself, so each of those
 * leaves the value undefined.
 */
export function resolveStaticText(ctx: StaticTextContext): StaticText | undefined {
  const { value, syntax } = ctx
  if (value === '')
    return undefined
  const literals = literalSpans(value, syntax)
  if (literals === undefined)
    return undefined
  const { pieces, runtime } = textPieces(value, ctx, literals)
  return runtime || hasReservedOutside(value, literals, syntax.reserved ?? '')
    ? undefined
    : {
        value: render(value, pieces),
      }
}
