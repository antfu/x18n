# Migrate from i18n-ally

Use this when a project has i18n-ally settings: `i18n-ally.*`, legacy `vue-i18n-ally.*` or i18n-ally-next `i18n-ally-next.*` keys in `.vscode/settings.json` or a `*.code-workspace` file, or a `.vscode/i18n-ally-custom-framework.yml` (i18n-ally-next: `i18n-ally-next-custom-framework.yml`). `x18n migrate i18n-ally` converts them. It never deletes i18n-ally files.

## Steps

1. Record the baseline before you change anything: `npx @x18n/cli status --json` and `npx @x18n/cli keys --unused --json`. x18n already reads the i18n-ally settings without a config, so this is what the project gets today. **Done when** you have the locale list, the key count and the unused keys.
2. Preview the migration: `x18n migrate i18n-ally --dry-run`. It prints the files it would write and notes about settings it dropped. **Done when** you have read every note.
3. Ask the user about each **decision** the notes raise, in one message. The usual ones:
   - `translate.*` settings (machine translation engines) are dropped. x18n writes translate prompts instead (`x18n prompt translate --to <locale>`).
   - `languageTagSystem` is dropped: x18n uses locale codes exactly as they appear in file names.
   - A custom framework with `monopoly: true` turns the built-in presets off (`presets: []`).
   - Executed JS/TS locale files become read-only (`execute: true`).
   - Reviews are converted to `.x18n/reviews.yml`; key descriptions and `review.removeCommentOnResolved` are dropped.
   - The config format: `x18n.config.ts` by default, or `--format yml` / `--format json` for projects without Node.js tooling.
4. Write the files: `x18n migrate i18n-ally --json` (add `--format yml` if the user chose YAML; `--force` replaces an existing x18n config). It writes:
   - `x18n.config.ts` (or `.yml`, `.json`) from the project settings
   - `.x18n/custom.x18n-plugin.yml`, when there are custom regexes, a custom framework, refactor templates or `localeCountryMap` flags
   - editor settings in `.vscode/settings.json`: `x18n.displayLocale`, `x18n.annotationInPlace`, `x18n.annotations`, `x18n.annotationMaxLength`, `x18n.showFlags`
   - `.x18n/reviews.yml`, when `.vscode/i18n-ally-reviews.yml` or `.vscode/i18n-ally-next-reviews.yml` exists

   **Done when** the command exits with code 0 and `data.files` lists the files above that apply.
5. Verify: run `x18n doctor --json`, `x18n status --json` and `x18n keys --unused --json`, and compare them with the baseline of step 1. The locales and keys must match. The unused keys may shrink, because `keysInUse` and the derived-key rules now apply. **Done when** every difference is explained to the user.
6. Clean up, after the user agrees: the command's `data.removable` lists the i18n-ally settings that x18n no longer needs. Remove them from `.vscode/settings.json`, delete the custom framework file if listed, and suggest the VS Code extension `antfu.x18n` in place of `lokalise.i18n-ally` or `lydanne.i18n-ally-next`.

In VS Code, the extension offers the same migration when it finds i18n-ally settings and no x18n config: the command **x18n: Migrate from i18n-ally** previews the files and writes them on confirmation.

## What maps where

| i18n-ally | x18n |
| --- | --- |
| `localesPaths`, `pathMatcher`, `dirStructure`, `namespace` | `resources[].pattern`, with the same `{locale}`, `{namespace}`, `{namespaces}`, `{ext}` tokens |
| `enabledFrameworks` | `presets`: every i18n-ally framework has a preset (`vue` → `vue-i18n`, `react` → `react-intl`, `ember` → `ember-intl`, `chrome-ext` → `chrome-extension`); `general` and `custom` are dropped |
| `sourceLanguage` | `sourceLocale` |
| `displayLanguage` | VS Code setting `x18n.displayLocale` |
| `ignoredLocales` | `ignoreLocales` |
| `keystyle` | `keyStyle` |
| `disablePathParsing` | `keySeparator: false` (literal keys) |
| `defaultNamespace` | `namespace.default` |
| `enabledParsers`, `parsers.extendFileExtensions` | `formats` |
| `keysInUse`, `usage.derivedKeyRules`, `usage.scanningIgnore` | `usage.keysInUse`, `usage.derivedKeys`, `usage.exclude` |
| `regex.usageMatch`, `regex.usageMatchAppend` | `scanners.regex` in the generated YAML plugin |
| `refactor.templates` | `extract.templates` |
| `extract.*` | `extract.*`, same meaning |
| `sortKeys`, `sortCompare`, `indent`, `tabStyle`, `keepFulfilled` | `write.sort`, `write.indent`, `write.keepFilled` |
| `annotations`, `annotationInPlace`, `annotationInPlaceFullMatch`, `annotationMaxLength`, `showFlags`, `theme.annotation*` | VS Code settings with the same names under `x18n.*` |
| `localeCountryMap` | `localeInfo` flags in the generated YAML plugin |
| custom framework `languageIds`, `usageMatchRegex`, `scopeRangeRegex`, `refactorTemplates`, `monopoly` | the generated YAML plugin: `scanners.regex`, `scopes.regex`, `extract.templates`; `monopoly` sets `presets: []` |

The full map is on the docs page <https://x18n.dev/migration>.
