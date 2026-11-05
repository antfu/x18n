import type { PlaceholderSyntax } from '@x18n/core'

/** Replace simple placeholders whose names are static call params. A formatted or plural/select argument keeps its text because the runtime value is not the raw param. */
export function fillParams(value: string, params: Readonly<Record<string, string>> | undefined, syntaxes: readonly PlaceholderSyntax[]): string {
  if (!params)
    return value
  const spans: { start: number, end: number, text: string }[] = []
  for (const syntax of syntaxes) {
    if (syntax.reference)
      continue
    for (const placeholder of syntax.find(value)) {
      const text = params[placeholder.name]
      if (text === undefined || /[,|]/.test(placeholder.text))
        continue
      spans.push({ start: placeholder.range.start, end: placeholder.range.end, text })
    }
  }
  if (spans.length === 0)
    return value
  spans.sort((a, b) => a.start - b.start || a.end - b.end)
  const kept: typeof spans = []
  for (const span of spans) {
    const last = kept.at(-1)
    if (last && span.start < last.end)
      continue
    kept.push(span)
  }
  let out = value
  for (let i = kept.length - 1; i >= 0; i--) {
    const span = kept[i]!
    out = out.slice(0, span.start) + span.text + out.slice(span.end)
  }
  return out
}
