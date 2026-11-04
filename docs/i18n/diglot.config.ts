import { defineConfig } from '@diglot/core'

const locales = [
  'zh-Hans',
  'zh-Hant',
  'ja',
  'ko',
  'ru',
  'fr',
  'de',
  'it',
  'pt-BR',
  'es',
]

export default defineConfig({
  locales,
  sources: [
    {
      name: 'docs',
      repo: 'x18n-dev/x18n',
      path: '../..',
      dir: 'docs/content',
      // The translated pages, which docs/scripts/translate.ts writes to `content/<locale in lowercase>`.
      exclude: locales.map(locale => `${locale.toLowerCase()}/**`),
    },
  ],
  glossary: 'glossary.yml',
  mt: {
    model: 'anthropic/claude-sonnet-5.5',
    subject: 'the documentation of x18n, a tool that checks and maintains the i18n locale files of a project',
    batch: 'page',
    qaRetries: 1,
  },
})
