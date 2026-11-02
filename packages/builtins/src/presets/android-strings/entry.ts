import type { PresetEntry } from '@x18n/core'

const entry: PresetEntry = {
  // React Native, Flutter and Capacitor apps have an `android` folder too, with strings that aren't their messages.
  detect: async ctx => await ctx.fileExists('**/AndroidManifest.xml')
    && await ctx.fileExists('**/res/values/*.xml')
    && !await ctx.fileExists('package.json')
    && !await ctx.fileExists('pubspec.yaml'),
  load: () => import('./index'),
}

export default entry
