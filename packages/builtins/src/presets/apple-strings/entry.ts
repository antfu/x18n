import type { PresetEntry } from '@x18n/core'

const entry: PresetEntry = {
  detect: async ctx => await ctx.fileExists('**/*.lproj/*.{strings,stringsdict}') || await ctx.fileExists('**/*.xcstrings'),
  load: () => import('./index'),
}

export default entry
