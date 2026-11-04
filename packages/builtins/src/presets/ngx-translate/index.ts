import type { Preset } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
// Detection and syntax adapted from i18n-ally (MIT), src/frameworks/*
import { doubleBraces } from '../../placeholders'
import { angularTemplates, htmlTemplates } from '../shared/angular-templates'

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
            ],
            // Interpolation params only; ngx-translate reads no option of its own from them.
            params: { arg: 1 },
          },
          // The marker takes the key alone.
          { callee: '_' },
        ],
        regex: [
          {
            extensions: angularTemplates,
            patterns: [
              // Not the first argument of an earlier pipe: `| explanationKey: 'title' | translate`.
              '(?<!\\|[\\s\\n]*[\\w$]+[\\s\\n]*:[\\s\\n]*)[`\'"]({key})[`\'"][\\s\\n]*\\|[\\s\\n]*translate\\b',
              '\\?[\\s\\n]*[`\'"]({key})[`\'"][\\s\\n]*:[\\s\\n]*[`\'"][\\w\\d\\. \\-\\[\\]\\/:]+?[`\'"][\\s\\n]*\\)[\\s\\n]*\\|[\\s\\n]*translate\\b',
              '\\?[\\s\\n]*[`\'"][\\w\\d\\. \\-\\[\\]\\/:]+?[`\'"][\\s\\n]*:[\\s\\n]*[`\'"]({key})[`\'"][\\s\\n]*\\)[\\s\\n]*\\|[\\s\\n]*translate\\b',
              // The first branch of a ternary whose else-branch is itself a ternary of two strings.
              '\\?[\\s\\n]*[`\'"]({key})[`\'"][\\s\\n]*:[^`\'"]*?\\?[\\s\\n]*[`\'"][\\w\\d\\. \\-\\[\\]\\/:]+?[`\'"][\\s\\n]*:[\\s\\n]*[`\'"][\\w\\d\\. \\-\\[\\]\\/:]+?[`\'"][\\s\\n]*\\)[\\s\\n]*\\|[\\s\\n]*translate\\b',
              '[\\s\\n]translate>[\\s\\n]*({key})[\\s\\n]*</',
              '\\[translate\\]=["\']\'({key})\'["\']',
              // Not the HTML `translate` attribute, whose values are `yes` and `no`.
              '\\stranslate=["\'](?!(?:yes|no)["\'])({key})["\']',
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
            template: '[{attr}]="\'{key}\' | translate"',
            kinds: ['html-attribute'],
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
      htmlTemplates(),
    ],
  }
}

export default ngxTranslate
