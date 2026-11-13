import type { Preset } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
// Detection and syntax adapted from i18n-ally (MIT), src/frameworks/*
import { icu } from '../../placeholders'

export function svelteI18n(): Preset {
  return {
    name: 'svelte-i18n',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:svelte-i18n',
        calls: [
          {
            callee: [
              '$_',
              '$t',
              '_',
              't',
            ],
            // `$_('key', { values: { name } })`: the message params live in `options.values`.
            params: {
              arg: 1,
              property: 'values',
            },
          },
          {
            callee: [
              '$format',
              '$json',
              'format',
              'json',
            ],
          },
        ],
        templates: [
          {
            template: '{$_(\'{key}\'{args})}',
            kinds: ['svelte-text'],
            imports: ['import { _ } from \'svelte-i18n\''],
          },
          {
            template: '{attr}={$_(\'{key}\'{args})}',
            kinds: ['svelte-attribute'],
            imports: ['import { _ } from \'svelte-i18n\''],
          },
        ],
        placeholders: [icu],
      }),
    ],
  }
}

export default svelteI18n
