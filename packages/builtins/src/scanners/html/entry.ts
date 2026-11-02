import type { ScannerEntry } from '@x18n/core'

const entry: ScannerEntry = {
  extensions: ['html'],
  load: () => import('./index'),
}

export default entry
