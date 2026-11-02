import type { Preset } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
// Detection and syntax adapted from i18n-ally (MIT), src/frameworks/*
import { icu } from '../../placeholders'
import { scriptExtensions } from '../shared'

export function lingui(): Preset {
  return {
    name: 'lingui',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:lingui',
        calls: [
          {
            callee: ['i18n._', 'i18n.t', 't', '_'],
          },
          {
            callee: [
              't',
              'msg',
              'defineMessage',
              'i18n._',
              'Trans',
            ],
            key: { arg: 0, property: 'id' },
          },
          {
            callee: 'useLingui',
            factory: true,
            returns: ['t', '_'],
          },
        ],
        regex: [
          {
            extensions: scriptExtensions,
            patterns: ['\\bt`({key})`', '<Trans>[\\s]*({key})[\\s]*<\\/Trans>'],
          },
        ],
        resources: [
          { pattern: 'src/locales/{locale}/messages.po' },
          { pattern: 'locales/{locale}/messages.po' },
        ],
        // Lingui keys are source messages, which may hold `.` and `:`.
        keySeparator: false,
        extra: (draft) => {
          draft.extract = { keygen: 'source', ...draft.extract }
        },
        templates: [
          {
            template: '<Trans>{key}</Trans>',
            kinds: ['jsx-text'],
            imports: ['import { Trans } from \'@lingui/react/macro\''],
          },
          {
            template: 't`{key}`',
            kinds: ['js-string', 'js-template'],
            imports: ['import { t } from \'@lingui/core/macro\''],
          },
        ],
        placeholders: [icu],
      }),
    ],
  }
}

export default lingui
