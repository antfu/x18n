import type { Preset } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
// Detection and syntax adapted from i18n-ally (MIT), src/frameworks/*
import { doubleBraces } from '../../placeholders'
import { regexScopes } from '../../scanners/regex-scopes'
import { angularTemplates, htmlTemplates } from '../shared/angular-templates'

export function transloco(): Preset {
  return {
    name: 'transloco',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:transloco',
        // The scope folder `todos-page` is the key prefix `todosPage.`.
        namespace: { fromPath: 'camel' },
        calls: [
          {
            callee: [
              'translate',
              'translocoService.translate',
              'transloco.translate',
              'translocoService.selectTranslate',
              'transloco.selectTranslate',
            ],
          },
        ],
        regex: [
          {
            extensions: angularTemplates,
            patterns: [
              '[`\'"]({key})[`\'"][\\s\\n]*\\|[\\s\\n]*transloco\\b',
              '[^\\w\\d]t\\([\\s\\n]*[\'"`]({key})[\'"`]',
              '[^*\\w\\d]transloco=[\'"`]({key})[\'"`]',
            ],
          },
        ],
        resources: [
          { pattern: 'src/assets/i18n/{locale}.json' },
          { pattern: 'src/assets/i18n/{namespaces}/{locale}.json' },
        ],
        templates: [
          {
            template: '{{ \'{key}\' | transloco }}',
            kinds: ['html-text'],
          },
          {
            template: '[{attr}]="\'{key}\' | transloco"',
            kinds: ['html-attribute'],
          },
          {
            template: 'translate(\'{key}\'{args})',
            kinds: ['js-string', 'js-template'],
            imports: ['import { translate } from \'@jsverse/transloco\''],
          },
        ],
        placeholders: [doubleBraces],
      }),
      htmlTemplates(),
      // `*transloco="let t; read: 'scope'"` prefixes the keys of the element.
      regexScopes('\\*transloco="[^"]*read:\\s*\'([^\']+)\'', 'transloco-read', {
        as: 'keyPrefix',
        extensions: ['html'],
      }),
    ],
  }
}

export default transloco
