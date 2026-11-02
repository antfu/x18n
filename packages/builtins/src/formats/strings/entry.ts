import type { FormatEntry } from '@x18n/core'

const entry: FormatEntry = {
  extensions: ['strings'],
  load: () => import('./index'),
}

export default entry
