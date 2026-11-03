import type { PresetEntry } from '@x18n/core'
import { dependsOn } from '../shared'

const entry: PresetEntry = {
  detect: dependsOn(['@lit/localize']),
  load: () => import('./index'),
}

export default entry
