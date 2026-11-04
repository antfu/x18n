import type { FormatEntry } from '@x18n/core'

const entry: FormatEntry = {
  extensions: ['xml'],
  load: () => import('./index'),
}

export default entry
