import type { FormatEntry } from '@x18n/core'

const entry: FormatEntry = {
  extensions: ['stringsdict'],
  load: () => import('./index'),
}

export default entry
