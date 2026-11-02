# 13 - Migration from i18n-ally

`x18n migrate i18n-ally` (CLI), "Migrate from i18n-ally" (VS Code). It reads:

- `.vscode/settings.json` (JSONC) keys `i18n-ally.*`, the legacy `vue-i18n-ally.*` and `i18n-ally-next.*` of the [i18n-ally-next](https://github.com/Lydanne/i18n-ally-next) fork, plus `*.code-workspace` settings. When a setting is set under more than one prefix, `i18n-ally-next.*` wins, then `i18n-ally.*`,
- `.vscode/i18n-ally-custom-framework.yml` (or the fork's `i18n-ally-next-custom-framework.yml`, which wins),
- `.vscode/i18n-ally-reviews.yml` (or the fork's `i18n-ally-next-reviews.yml`, which wins),

and writes `x18n.config.ts` (or `--format yml`), `.x18n/custom.x18n-plugin.yml` when a custom framework exists, and `.x18n/reviews.yml`. With `--dry-run` it prints the files. It never deletes i18n-ally files; it prints which settings can be removed.

## Settings map

| i18n-ally | x18n |
| --- | --- |
| `localesPaths` + `pathMatcher` + `dirStructure` + `namespace` | `resources[].pattern` (built from the three, using the same matcher tokens) |
| `enabledFrameworks` | `presets` (ids mapped; `vue` becomes `vue-i18n`, `react` becomes `react-intl`, `general` is dropped) |
| `enabledParsers`, `parsers.extendFileExtensions` | `formats` |
| `sourceLanguage` | `sourceLocale` |
| `displayLanguage` | VS Code setting `x18n.displayLocale` (editor UX) |
| `ignoredLocales` | `ignoreLocales` |
| `keystyle` | `keyStyle` |
| `defaultNamespace` | `namespace.default` |
| `languageTagSystem` | dropped; locale codes are used as found |
| `localeCountryMap` | a `localeInfo` rule in the generated YAML plugin (flags only) |
| `sortKeys`, `sortCompare`, `sortLocale`, `indent`, `tabStyle`, `keepFulfilled` | `write.sort`, `write.indent`, `write.keepFilled` |
| `keysInUse`, `usage.derivedKeyRules`, `usage.scanningIgnore` | `usage.keysInUse`, `usage.derivedKeys`, `usage.exclude` |
| `regex.usageMatch`, `regex.usageMatchAppend`, `regex.key` | a generated YAML plugin with `scanners.regex` |
| `refactor.templates` | `extract.templates` |
| `extract.keygenStrategy`, `keygenStyle`, `keyPrefix`, `keyMaxLength`, `ignored`, `ignoredByFiles`, `autoDetect` | `extract.*` with the same meaning |
| `annotations`, `annotationInPlace`, `annotationInPlaceFullMatch`, `annotationMaxLength`, `showFlags`, `theme.annotation*` | VS Code settings with the same names under `x18n.*` (written to `.vscode/settings.json`, editor UX only) |
| `extract.targetPickingStrategy` | dropped: the new-key placement rule of [02-core.md](./02-core.md) picks the target resource, and a tie is a decision |
| `annotationDelimiter` | dropped |
| `parsers.typescript.*` (executed JS/TS locale files) | `execute: true` on the matching `resources` pattern |
| `review.*` | `review.*` (`user.name` / `user.email` become `review.author`) |
| `translate.*` | dropped; replaced by translate prompts. The command prints a note. |
| `disablePathParsing` | `keySeparator: false` |
| `readonly`, `encoding`, `fullReloadOnChanged`, `includeSubfolders`, `ignoreFiles`, `editor.preferEditor` | handled by defaults or dropped; listed in the report |

## Custom framework map

| `i18n-ally-custom-framework.yml` | YAML plugin |
| --- | --- |
| `languageIds` | `scanners.regex[].extensions` (language ids mapped to extensions) |
| `usageMatchRegex` | `scanners.regex[].patterns` (`{key}` kept) |
| `scopeRangeRegex` | `scopes.regex` |
| `refactorTemplates` (`$1`) | `extract.templates` (`{key}`) |
| `monopoly` | `exclusive: true` on a generated preset wrapper |

## Tests

Each fixture in `test/fixtures/i18n-ally/*` holds i18n-ally settings and the expected x18n output. A parity test runs both configs on the same files and expects the same keys, usages and missing keys.
