import { defineConfig } from '@diglot/core'

export default defineConfig({
  locales: [
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
  ],
  sources: [
    {
      name: 'docs',
      repo: 'x18n-dev/x18n',
      path: '../..',
      dir: 'docs/content',
      exclude: ['zh-hans/**'],
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
