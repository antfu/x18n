import type { Preset } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
// Detection and syntax adapted from i18n-ally (MIT), src/frameworks/*
import { printf } from '../../placeholders'

/** PHP gettext with `.po` files. Exclusive and never detected, as in i18n-ally: list it in `presets`. */
export function phpGettext(): Preset {
  return {
    name: 'php-gettext',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:php-gettext',
        regex: [
          {
            extensions: ['php'],
            patterns: ['[^\\w\\d](?:gettext|_|__)\\(\\s*[\'"`]({key})[\'"`]'],
          },
        ],
        resources: [
          { pattern: 'locale/{locale}/LC_MESSAGES/*.po' },
          { pattern: 'locales/{locale}.po' },
        ],
        // gettext keys are source messages, which may hold `.` and `:`.
        keySeparator: false,
        extra: (draft) => {
          draft.extract = { keygen: 'source', ...draft.extract }
        },
        templates: [
          { template: 'gettext(\'{key}\')' },
        ],
        placeholders: [printf],
      }),
    ],
  }
}

export default phpGettext
