---
title: Migration from i18n-ally
description: Convert i18n-ally settings, custom frameworks and reviews into an x18n config with x18n migrate i18n-ally.
---

x18n is a successor of [i18n-ally](https://github.com/lokalise/i18n-ally). It reads the same kinds of projects, and it moves the logic out of VS Code, so it also runs in CI, in the browser and for agents. `x18n migrate i18n-ally` converts the i18n-ally settings of a project into an x18n config.

## Run the migration

Run the command in the root of the project. First look at the result with `--dry-run`. It prints the files and writes nothing:

```sh
pnpx @x18n/cli migrate i18n-ally --dry-run
pnpx @x18n/cli migrate i18n-ally
```

The command reads:

- the `i18n-ally.*` keys, the legacy `vue-i18n-ally.*` keys, and the `i18n-ally-next.*` keys of the [i18n-ally-next](https://github.com/Lydanne/i18n-ally-next) fork, in `.vscode/settings.json`,
- the `settings` of each `*.code-workspace` file in the root,
- `.vscode/i18n-ally-custom-framework.yml`, or `.vscode/i18n-ally-next-custom-framework.yml`,
- `.vscode/i18n-ally-reviews.yml`, or `.vscode/i18n-ally-next-reviews.yml`.

When a setting or file exists under both names, the i18n-ally-next one wins.

It writes:

| File | When |
| --- | --- |
| `x18n.config.ts` | Always. `--format yml` or `--format json` writes `x18n.config.yml` or `x18n.config.json` instead. |
| `.x18n/custom.x18n-plugin.yml` | When the settings hold regex scanners, scopes, refactor templates, locale flags, or a custom framework. The config lists it in `plugins`. |
| `.vscode/settings.json` | When editor settings move to the x18n extension. |
| `.x18n/reviews.yml` | When i18n-ally reviews exist, and this file does not. The comments are converted to [x18n reviews](/guide/reviews). |

The command never deletes i18n-ally files or settings. At the end, it lists the i18n-ally settings that you can remove. If an `x18n.config.*` file exists, the command stops. Pass `--force` to replace it.

For a Vue project with these settings:

```json [.vscode/settings.json]
{
  "i18n-ally.localesPaths": ["lang"],
  "i18n-ally.namespace": true,
  "i18n-ally.pathMatcher": "{locale}/{namespaces}.json",
  "i18n-ally.enabledFrameworks": ["vue", "general"],
  "i18n-ally.sourceLanguage": "en",
  "i18n-ally.displayLanguage": "de",
  "i18n-ally.keysInUse": ["dynamic.*"],
  "i18n-ally.annotationInPlace": false,
  "i18n-ally.extract.keygenStyle": "snake_case"
}
```

the migration writes:

```ts [x18n.config.ts]
import { defineConfig } from '@x18n/core'

// Migrated from i18n-ally by `x18n migrate i18n-ally`.
export default defineConfig({
  sourceLocale: 'en',
  presets: ['vue-i18n'],
  resources: [
    { pattern: 'lang/{locale}/{namespaces}.json' }
  ],
  usage: {
    keysInUse: ['dynamic.*'],
  },
  extract: {
    keyCase: 'snake',
  },
})
```

and adds `"x18n.annotationInPlace": false` and `"x18n.displayLocale": "de"` to `.vscode/settings.json`.

## In VS Code

When a folder has `i18n-ally.*` settings in `.vscode/settings.json` and no `x18n.config.*` file, the [x18n extension](/surfaces/vscode) offers to migrate it. It opens the files that it will write, and writes them only after you confirm. Then it restarts the language server. You can also run "x18n: Migrate from i18n-ally" from the command palette.

## Settings map

| i18n-ally | x18n |
| --- | --- |
| `localesPaths`, `pathMatcher`, `dirStructure`, `namespace` | `resources[].pattern`. `pathMatcher` uses the same tokens. Without it, `dirStructure` picks `{locale}.{ext}` or `{locale}/...`, and `namespace` adds `{namespaces}`. |
| `enabledFrameworks` | `presets`. See [Framework map](#framework-map). |
| `enabledParsers`, `parsers.extendFileExtensions` | `formats` |
| `sourceLanguage` | `sourceLocale` |
| `ignoredLocales` | `ignoreLocales` |
| `keystyle` | `keyStyle` |
| `disablePathParsing` | `keySeparator: false` |
| `defaultNamespace` | `namespace.default` |
| `keysInUse` | `usage.keysInUse` |
| `usage.derivedKeyRules` | `usage.derivedKeys` |
| `usage.scanningIgnore` | `usage.exclude` |
| `sortKeys`, `sortCompare` | `write.sort`: `locale` when `sortCompare` is `locale`, else `binary` |
| `indent`, `tabStyle` | `write.indent` |
| `keepFulfilled` | `write.keepFilled` |
| `extract.keygenStrategy` | `extract.keygen` |
| `extract.keygenStyle` | `extract.keyCase`: `camelCase`, `snake_case` and `kebab-case` become `camel`, `snake` and `kebab` |
| `extract.keyPrefix`, `extract.keyMaxLength`, `extract.autoDetect` | The same names under `extract` |
| `extract.ignored`, `extract.ignoredByFiles` | `extract.ignore`, `extract.ignoreByFile` |
| `refactor.templates` | `extract.templates` in the generated plugin. `$1` becomes `{key}`. |
| `regex.usageMatch`, `regex.usageMatchAppend` | `scanners.regex` in the generated plugin, for JS, TS, Vue, HTML and Svelte files |
| `localeCountryMap` | `localeInfo` flags in the generated plugin |
| `parsers.typescript.*` | `execute: true` on the JS and TS resource patterns. These resources are read-only. |
| `review.enabled` | `review.enabled` |
| `review.user.name`, `review.user.email` | `review.author` |
| `.vscode/i18n-ally-reviews.yml` | `.x18n/reviews.yml`: comments keep their id, author, time and resolved state; `request_change` becomes `request-change`; a comment with a `suggestion` becomes a `suggestion`; a translation candidate becomes a `suggestion` too. |
| `annotations`, `annotationInPlace`, `annotationInPlaceFullMatch`, `annotationMaxLength`, `displayLanguage`, `showFlags`, `theme.annotation*` | The VS Code settings with the same names under `x18n.*`; `displayLanguage` becomes `x18n.displayLocale` |

## Framework map

| i18n-ally framework | x18n preset |
| --- | --- |
| `vue`, `vue-sfc`, `vuex` | `vue-i18n` |
| `nuxt` | `nuxt-i18n` |
| `fluent-vue`, `fluent-vue-sfc` | `fluent-vue` |
| `react` | `react-intl` |
| `react-i18next`, `next-i18next` | `react-i18next` |
| `i18next` | `i18next` |
| `i18next-shopify` | `i18next-shopify` |
| `next-intl` | `next-intl` |
| `next-international` | `next-international` |
| `next-translate` | `next-translate` |
| `svelte` | `svelte-i18n` |
| `ngx-translate` | `ngx-translate` |
| `transloco` | `transloco` |
| `lingui` | `lingui` |
| `ember` | `ember-intl` |
| `polyglot` | `polyglot` |
| `globalize` | `globalize` |
| `i18n-tag` | `i18n-tag` |
| `i18n-js` | `ruby-i18n-js` |
| `ui5` | `ui5` |
| `chrome-ext` | `chrome-extension` |
| `vscode` | `vscode-extension` |
| `laravel` | `laravel` |
| `php-joomla` | `php-joomla` |
| `php-gettext` | `php-gettext` |
| `ruby-rails` | `ruby-rails` |
| `jekyll` | `jekyll` |
| `flutter` | `flutter` |
| `general`, `custom` | Dropped. A custom framework becomes the generated plugin. |

Every framework of i18n-ally has a preset. For an unknown framework id, the command prints a note and leaves it out.

## Custom framework map

`.vscode/i18n-ally-custom-framework.yml` becomes `.x18n/custom.x18n-plugin.yml`:

| Custom framework | YAML plugin |
| --- | --- |
| `languageIds` | `scanners.regex[].extensions`. Language ids become extensions, for example `typescriptreact` becomes `tsx`. |
| `usageMatchRegex` | `scanners.regex[].patterns`, with `{key}` as it is |
| `scopeRangeRegex` | `scopes.regex` |
| `refactorTemplates` | `extract.templates`. `$1` becomes `{key}`. |
| `monopoly: true` | `presets: []` in the config, so no built-in preset applies |

## What is dropped

- `translate.*`: x18n calls no translation service. It writes [translate prompts](/agents/prompts) for an agent or an LLM instead. The command prints a note.
- `review.removeCommentOnResolved`: x18n keeps resolved reviews, and `x18n review list --open` hides them. Key descriptions in the review file are dropped too. The command prints a note for each.
- `readonly`, `encoding`, `fullReloadOnChanged`, `includeSubfolders`, `ignoreFiles`, `editor.preferEditor`, `annotationDelimiter`, `languageTagSystem`, `targetPickingStrategy` and `extract.targetPickingStrategy`: the defaults of x18n handle them, or x18n has no such setting. The command prints a note for each one it finds. x18n uses locale codes as written, so it needs no `languageTagSystem`.

Settings that are not on this page are not migrated.

## After the migration

1. Run `pnpx @x18n/cli doctor` and make sure that x18n found your locale files and presets.
2. Run `pnpx @x18n/cli check`.
3. Install the [x18n extension](/surfaces/vscode), and turn i18n-ally off for the workspace.
4. Remove the i18n-ally settings that the command listed.
