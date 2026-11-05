import type { Plugin, ReviewFile, ReviewStore } from '@x18n/core'
import { ReviewFileSchema, validate } from '@x18n/core'
import { parse, stringify } from 'yaml'

const header = '# yaml-language-server: $schema=https://x18n.dev/schema/reviews.json\n'

/** Reviews in a YAML file (`.x18n/reviews.yml`), tracked in git so they show up in pull requests. */
export const yamlReviewStore: ReviewStore = {
  id: 'yaml',
  parse(text) {
    const result = validate(ReviewFileSchema, parse(text) ?? { x18n: 1 })
    if (!result.success)
      throw new Error(result.issues.map(issue => `${issue.path || '(root)'}: ${issue.message}`).join('; '))
    return { threads: result.output.threads ?? {}, sources: result.output.sources ?? {}, machine: result.output.machine ?? {} }
  },
  serialize(data) {
    const file: ReviewFile = {
      x18n: 1,
      ...Object.keys(data.threads).length > 0 && { threads: data.threads },
      ...Object.keys(data.sources).length > 0 && { sources: data.sources },
      ...Object.keys(data.machine ?? {}).length > 0 && { machine: data.machine },
    }
    return header + stringify(file, { lineWidth: 0, aliasDuplicateObjects: false })
  },
}

export function reviews(): Plugin {
  return {
    name: 'x18n:reviews',
    reviewStores: [yamlReviewStore],
  }
}
