import { defineConfig } from '@x18n/core'

/** The messages of the UI and of the VS Code extension; `x18n check --strict` runs on them in CI. */
export default defineConfig({
  sourceLocale: 'en',
  projects: ['packages/ui', 'packages/vscode'],
  // Terms of plans/glossary.md, so translators of the UI and the extension name things the same way everywhere.
  glossary: [
    { term: 'x18n', doNotTranslate: true },
    { term: 'key', note: 'A message identifier such as `nav.home`, not a keyboard key or a password.' },
    { term: 'locale', note: 'A language (and region) code such as `de` or `pt-BR`.' },
    { term: 'source locale', note: 'The locale every other locale is translated from.' },
    { term: 'resource', note: 'A file holding the messages of one locale.' },
    { term: 'usage', note: 'A place in source code that uses a key.' },
    { term: 'preset', note: 'A built-in setup for one i18n library, such as vue-i18n.' },
    { term: 'placeholder', note: 'A variable in a message, such as `{name}`.' },
    { term: 'namespace', note: 'A group of keys, often one file per locale.' },
  ],
})
