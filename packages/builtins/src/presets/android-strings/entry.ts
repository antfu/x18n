import type { PresetEntry } from '@x18n/core'

const entry: PresetEntry = {
  // React Native, Flutter, Capacitor, Cordova and NativeScript apps have an `android` folder too, with strings that aren't their messages.
  // A native app may still have a package.json, for tooling.
  detect: async ctx => await ctx.fileExists('**/AndroidManifest.xml')
    && await ctx.fileExists('**/res/values/*.xml')
    && !ctx.hasAnyDependency([
      'react-native',
      'expo',
      '@capacitor/android',
      '@capacitor/core',
      'cordova-android',
      '@nativescript/core',
    ])
    && !await ctx.fileExists('pubspec.yaml'),
  load: () => import('./index'),
}

export default entry
