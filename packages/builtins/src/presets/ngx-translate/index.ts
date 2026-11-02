import type { Preset } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
// Detection and syntax adapted from i18n-ally (MIT), src/frameworks/*
import { doubleBraces } from '../../placeholders'
import { angularTemplates } from '../shared/angular-templates'

export function ngxTranslate(): Preset {
  return {
    name: 'ngx-translate',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:ngx-translate',
        calls: [
          {
            callee: [
              'translate',
              'translate.instant',
              'translate.get',
              'translate.stream',
              'translateService.instant',
              'translateService.get',
              'translateService.stream',
              '_',
            ],
          },
        ],
        regex: [
          {
            extensions: angularTemplates,
            patterns: [
              '[`\'"]({key})[`\'"][\\s\\n]*\\|[\\s\\n]*translate\\b',
              '\\?[\\s\\n]*[`\'"]({key})[`\'"][\\s\\n]*:[\\s\\n]*[`\'"][\\w\\d\\. \\-\\[\\]\\/:]+?[`\'"][\\s\\n]*\\)[\\s\\n]*\\|[\\s\\n]*translate\\b',
              '\\?[\\s\\n]*[`\'"][\\w\\d\\. \\-\\[\\]\\/:]+?[`\'"][\\s\\n]*:[\\s\\n]*[`\'"]({key})[`\'"][\\s\\n]*\\)[\\s\\n]*\\|[\\s\\n]*translate\\b',
              '[\\s\\n]translate>[\\s\\n]*({key})[\\s\\n]*</',
              '\\[translate\\]=["\']\'({key})\'["\']',
              '\\stranslate=["\']({key})["\']',
            ],
          },
        ],
        resources: [
          { pattern: 'src/assets/i18n/{locale}.json' },
          { pattern: 'src/assets/i18n/{locale}/{namespaces}.json' },
        ],
        templates: [
          {
            template: '{{ \'{key}\' | translate }}',
            kinds: ['html-text'],
          },
          {
            template: 'this.translate.instant(\'{key}\'{args})',
            kinds: ['js-string', 'js-template'],
          },
          {
            template: 'translate(\'{key}\'{args})',
            kinds: ['js-string', 'js-template'],
            imports: ['import { translate } from \'@ngx-translate/core\''],
          },
        ],
        placeholders: [doubleBraces],
      }),
    ],
  }
}

export default ngxTranslate
