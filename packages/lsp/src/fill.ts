import type { Placeholder, PlaceholderSyntax } from '@x18n/core'

/**
 * Reads the text a placeholder renders from a call's static params. A formatted or plural/select
 * argument keeps its text because the runtime value is not the raw param, and a linked message
 * reads a key, so both stay undefined.
 */
export function paramText(params: Readonly<Record<string, string>> | undefined, syntaxes: readonly PlaceholderSyntax[]): (placeholder: Placeholder) => string | undefined {
  const references = new Set(syntaxes
    .filter(syntax => syntax.reference === true)
    .map(syntax => syntax.id))
  return (placeholder) => {
    if (params === undefined || references.has(placeholder.syntax))
      return undefined
    const text = params[placeholder.name]
    return text === undefined || /[,|]/.test(placeholder.text)
      ? undefined
      : text
  }
}
