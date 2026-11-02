import type { Plugin } from '@x18n/core'
import html from '../../scanners/html/entry'

export const angularTemplates: readonly string[] = ['html', 'ts', 'js']

/**
 * The `html` scanner, for the hard strings of Angular templates. Presets list it rather than every project, since a
 * plain `index.html` in a React or Vue app is not where its messages go. It loads when an `.html` file is first scanned.
 */
export function htmlTemplates(): Plugin {
  return {
    name: 'x18n:scanner-html',
    lazyScanners: [
      { id: 'html', ...html },
    ],
  }
}
