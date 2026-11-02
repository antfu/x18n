import type { FormatEntry } from '@x18n/core'

const entry: FormatEntry = {
  extensions: ['xcstrings'],
  load: () => import('./index'),
}

export default entry
