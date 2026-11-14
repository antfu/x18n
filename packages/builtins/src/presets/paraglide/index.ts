import type { Preset } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
// Detection and syntax adapted from i18n-ally (MIT), src/frameworks/*
import { braces } from '../../placeholders'
import { paraglideScanner } from './scanner'

export function paraglide(): Preset {
  return {
    name: 'paraglide',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:paraglide',
        resources: [
          { pattern: 'messages/{locale}.json' },
        ],
        templates: [
          {
            template: '{m[\'{key}\']({args})}',
            kinds: ['jsx-text', 'svelte-text', 'astro-text'],
            imports: ['import { m } from \'$lib/paraglide/messages\''],
          },
          {
            template: 'm[\'{key}\']({args})',
            kinds: ['js-string', 'js-template'],
            imports: ['import { m } from \'$lib/paraglide/messages\''],
          },
        ],
        placeholders: [braces],
      }),
      {
        name: 'x18n:paraglide-usages',
        scanners: [paraglideScanner],
      },
    ],
  }
}

export default paraglide
