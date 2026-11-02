// Adapted from @lit/localize (BSD-3-Clause), internal/id-generation.js, with FNV-1a as BigInt.

const prime = 0x100000001B3n
const mask = 0xFFFFFFFFFFFFFFFFn

function fnv1a64(text: string): string {
  let hash = 0xCBF29CE484222325n
  for (let i = 0; i < text.length; i++)
    hash = ((hash ^ BigInt(text.charCodeAt(i))) * prime) & mask
  return hash.toString(16).padStart(16, '0')
}

/** The id `lit-localize` gives a message: its kind, then a hash of the parts of its template. */
export function messageId(parts: readonly string[], html: boolean): string {
  return (html ? 'h' : 's') + fnv1a64(parts.join('\x1E'))
}
