import type { Preset } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
// Detection and syntax adapted from i18n-ally (MIT), src/frameworks/*
import { icu } from '../../placeholders'

export function reactIntl(): Preset {
  return {
    name: 'react-intl',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:react-intl',
        calls: [
          {
            callee: [
              'intl.formatMessage',
              'formatMessage',
              'defineMessage',
              'FormattedMessage',
            ],
            key: { arg: 0, property: 'id' },
            description: 'description',
          },
          {
            callee: 'defineMessages',
            key: { arg: 0, property: '*.id' },
            description: 'description',
          },
        ],
        templates: [
          {
            template: '<FormattedMessage id="{key}" />',
            kinds: ['jsx-text'],
            imports: ['import { FormattedMessage } from \'react-intl\''],
          },
          {
            template: '{attr}={intl.formatMessage({ id: \'{key}\' }{args})}',
            kinds: ['jsx-attribute'],
          },
          {
            template: 'intl.formatMessage({ id: \'{key}\' }{args})',
            kinds: ['js-string', 'js-template'],
          },
        ],
        placeholders: [icu],
      }),
    ],
  }
}

export default reactIntl
