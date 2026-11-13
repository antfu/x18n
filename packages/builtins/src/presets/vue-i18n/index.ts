import type { CallSpec, Preset } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
// Detection and syntax adapted from i18n-ally (MIT), src/frameworks/*
import { sfcBlocks } from '../../finders/sfc-blocks'
import { braces, linked, messageLiteral } from '../../placeholders'

const vueI18nParams: NonNullable<CallSpec['params']> = {
  arg: [1, 2],
  options: [
    'locale',
    'fallbackLocale',
    'default',
    'missing',
    'plural',
    'escapeParameter',
  ],
}

const vueI18nCalls: CallSpec[] = [
  {
    callee: [
      '$t',
      't',
      'tc',
      '$tc',
      'te',
      '$te',
      'tm',
      '$tm',
      'i18n.t',
      'i18n.global.t',
      '$i18n.t',
      'i18n.tc',
      'i18n.te',
    ],
    params: vueI18nParams,
  },
  {
    callee: 'useI18n',
    factory: true,
    returns: ['t', 'tc', 'te', 'tm'],
    params: vueI18nParams,
  },
]

export function vueI18n(): Preset {
  return {
    name: 'vue-i18n',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:vue-i18n',
        calls: vueI18nCalls,
        templates: [
          {
            template: '{{ $t(\'{key}\'{args}) }}',
            kinds: ['vue-template-text'],
          },
          {
            template: ':{attr}="$t(\'{key}\'{args})"',
            kinds: ['vue-attribute'],
          },
          {
            template: 't(\'{key}\'{args})',
            kinds: ['js-string', 'js-template'],
            files: ['**/*.vue'],
            imports: ['import { useI18n } from \'vue-i18n\'', 'const { t } = useI18n()'],
          },
        ],
        placeholders: [
          {
            ...braces,
            implicit: ['n', 'count'],
          },
          linked,
        ],
        // A bare `@` starts a linked message, a bare brace a placeholder or a literal, and a bare `|` a plural list, so each of them is syntax.
        messageSyntax: {
          literals: [messageLiteral],
          reserved: '@{}|',
        },
      }),
      // vue-i18n passes `n` and `count` to plural messages.
      sfcBlocks(),
    ],
  }
}

export default vueI18n
