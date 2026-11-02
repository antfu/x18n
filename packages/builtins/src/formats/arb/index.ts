import type { MessageTree, Plugin } from '@x18n/core'
import type { JsonOptions } from '../shared/json'
import { isMessageLeaf, pathId } from '@x18n/core'
import { createJsonFormat } from '../shared/json'

/** The `description` of each `@key` metadata entry, keyed by the path of `key`. */
function descriptionsOf(tree: MessageTree): Map<string, string> {
  const descriptions = new Map<string, string>()
  for (const [name, entry] of Object.entries(tree)) {
    if (!name.startsWith('@') || name.startsWith('@@') || isMessageLeaf(entry))
      continue
    const description = entry.description
    if (typeof description === 'string' && description.trim() !== '') {
      descriptions.set(pathId([
        name.slice(1),
      ]), description)
    }
  }
  return descriptions
}

/** Application Resource Bundle files: JSON, where `@@locale` and `@key` entries are metadata that presets set aside. `@key.description` describes `key`. */
export function arb(options: JsonOptions = {}): Plugin {
  const json = createJsonFormat('arb', ['arb'], true, options.indent)
  return {
    name: 'x18n:format-arb',
    formats: [
      {
        ...json,
        parse(text, ctx) {
          const parsed = json.parse(text, ctx)
          return {
            ...parsed,
            descriptions: descriptionsOf(parsed.tree),
          }
        },
      },
    ],
  }
}

export default arb
