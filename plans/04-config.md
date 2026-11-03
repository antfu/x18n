# 04 - Config

## Files

`x18n.config.ts` is the primary format. `x18n init` writes it, and docs and examples lead with it. YAML and JSON stay supported for non-JS projects (PHP, Ruby, Flutter) and for the in-browser workspace.

x18n looks these up from the project root; the first match wins:

```
x18n.config.ts  x18n.config.mts  x18n.config.js  x18n.config.mjs
x18n.config.yml  x18n.config.yaml  x18n.config.json
```

`@x18n/node` loads them with `unconfig` (TS through its built-in loader). Without a config file, x18n applies the project's i18n-ally settings as defaults when there are any (D35), else runs on detection alone, the same as i18n-ally `autoDetection`.

```ts
// x18n.config.ts
import { vueI18n } from '@x18n/builtins/presets/vue-i18n'
import { defineConfig } from '@x18n/core'

export default defineConfig({
  sourceLocale: 'en',
  presets: [
    vueI18n({ sfc: true })
  ],
  resources: [
    { pattern: 'src/locales/{locale}.json' }
  ],
  checks: { 'unused-key': 'error' },
})
```

```yaml
# x18n.config.yml
# yaml-language-server: $schema=https://x18n.dev/schema/config.json
sourceLocale: en
presets: [vue-i18n]
plugins:
  - ./.x18n/acme.x18n-plugin.yml
  - [x18n-plugin-foo, {strict: true}]
resources:
  - pattern: 'src/locales/{locale}.json'
```

Project settings live only in the config file. Editors have UX settings only and never override config values, so the CLI, CI and editor always agree ([08-vscode.md](./08-vscode.md)).

## Options

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `root` | string | config dir | Project root. |
| `sourceLocale` | string | detected, else `en` | Source of truth for checks, prompts and definitions. |
| `locales` | string[] | all found | Filter. Codes as written in paths, never normalized. |
| `ignoreLocales` | string[] | `[]` | |
| `presets` | `'auto' \| PresetOption[]` | `'auto'` | `'auto'` runs `detect` of all built-in presets. |
| `plugins` | PluginOption[] | `[]` | Plugin object, factory result, module specifier, or `[specifier, options]`. |
| `resources` | ResourceSpec[] | from presets | `{ pattern, format?, namespace?, locale?, execute?, keySeparator? }`. `keySeparator` overrides the config's for matching files (Laravel `lang/{locale}.json` is `false`). Feeds the `pattern` finder. `execute: true` runs matching JS/TS files in Node and makes them read-only ([05-builtins.md](./05-builtins.md)). |
| `formats` | `Record<ext, formatId>` | by extension | Explicit format per extension. |
| `keyStyle` | `'auto' \| 'nested' \| 'flat'` | `'auto'` | `'auto'` keeps what each file uses. New files use the style of most files. |
| `keySeparator` | `string \| false` | `'.'` | What splits a key into a path. `false` makes keys literal: `Welcome back.` and `Note: x` are one key, written as one property, with no parents (i18next `keySeparator: false`, gettext, Laravel JSON). Set by presets that need it. |
| `namespace` | `{ separator?, default?, fallback?, byFile?, fromPath? }` | from presets | `separator: false` (i18next `nsSeparator: false`) means code never names a namespace, so keys in code may hold `:`. `fallback` lists the namespaces searched when a key is not in its own (i18next `fallbackNS`). `byFile` maps source globs to the namespace of keys written without one. `fromPath` names a namespace from `{namespaces}` folders: `dot` (default, `pages.home`), `slash` (i18next, `pages/home`), `camel` (Transloco, `todos-page` is `todosPage`) |
| `usage.include` / `usage.exclude` | string[] | `**/*` / gitignore + build dirs | Source files to scan. |
| `usage.gitignore` | boolean | `true` | Skip files that `.gitignore` ignores. `false` scans a git-ignored checkout, such as a clone of the sources in a translations repository (D44). |
| `usage.calls` | CallSpec[] | from presets | Extra callee names, factories, wrappers, typed params ([03-plugins.md](./03-plugins.md)). |
| `usage.ignoreCallees` | string[] | `[]` | Callee names never counted, for false positives of name matching. |
| `usage.keysInUse` | string[] (globs) | `[]` | Keys that count as used, for example keys built at runtime. |
| `usage.derivedKeys` | string[] | from presets | Extra derived-key rules. |
| `write.sort` | `false \| 'binary' \| 'locale'` | `false` | |
| `write.indent` | number \| `'tab'` | detect per file | |
| `write.keepFilled` | boolean | `false` | i18n-ally `keepFulfilled`. |
| `extract` | ExtractOptions | from presets | See [11-extraction.md](./11-extraction.md). |
| `checks` | `Record<checkId, Severity \| 'off' \| [Severity, options]>` | `recommended` | ESLint-like overrides on top of the `recommended` set. |
| `strict` | boolean | `false` | Turn every warning into an error (also `x18n check --strict`). |
| `ignoreKeys` | string[] (globs) | `[]` | Keys excluded from all checks. |
| `history` | `boolean` or `{ providers?, git? }` | `true` | History providers for stale translations ([19-history.md](./19-history.md)). |
| `glossary` | `{ term, translations?, note?, doNotTranslate? }[]` or path | `[]` | Used by translate prompts and the optional `glossary` check. |
| `projects` | string[] (globs) | - | Monorepo, see below. |
| `typegen` | `boolean \| { output? }` | `false` | 1.x, TS projects only ([18-typegen.md](./18-typegen.md)). |
| `review` | `{ enabled?, file?, author? }` | `{ enabled: true, file: '.x18n/reviews.yml' }` | [12-reviews.md](./12-reviews.md). |

Plugin options live under the plugin's own key in `PluginConfigs` (see [03-plugins.md](./03-plugins.md)) or in the factory call.

## Monorepos

A root `x18n.config.ts` lists `projects: ['apps/*', 'packages/ui']`. Each match is a project with its own `x18n.config.ts` that inherits the root options and overrides what it sets. This is the same model as Vitest projects. A matched directory without a config file is a project with the root options and its own detection.

Without a config at or above the cwd, every config below it (outside `node_modules`) loads as a root config of its own, shallowest first, so a config that lists `projects` claims the configs of its projects. The LSP resolves each file to the project with the deepest root that holds it.

The CLI, LSP and UI show every project. `x18n check` checks all of them, and `--project <name>` narrows the run. Project names come from the directory name, or from `name` in the project config.

## Resolution

1. Load the file. YAML and JSON go through the valibot schema. TS goes through `defineConfig` types, then the same schema for the serializable part, so errors read the same.
2. Resolve plugin specifiers. Relative `.yml` / `.yaml` paths load as YAML plugins; other paths and package names are imported (Node only).
3. Expand presets. `'auto'` runs `detect` of every built-in preset. A listed preset always applies.
4. Run `config` hooks in plugin order on a mutable draft. Defaults from presets come first, then root config, then project config. Each value records its origin for `explain()`.
5. Validate the final config. Unknown keys are errors in YAML and JSON (typos are common there) and type errors in TS.
6. Freeze and call `configResolved` hooks.

## Schemas and types

- valibot schemas in `@x18n/core` are the single source for runtime validation, for the JSON Schemas, and for the TS types of the serializable part (`v.InferInput`).
- The `@x18n/core` build writes `schema/config.json` and `schema/plugin.json` with `@valibot/to-json-schema`. They are part of the package `exports`. The docs site serves the same files at `https://x18n.dev/schema/*.json`.
- `x18n-vscode` contributes `jsonValidation` for `x18n.config.json`, and `yaml.schemas` (through the YAML extension) for `x18n.config.y?(a)ml` and `*.x18n-plugin.y?(a)ml`.
- `defineConfig` in TS accepts more than the schema (plugin objects, functions). That part is typed by TS only, and the schema shows it as `plugins: (string | [string, object])[]`.
- A test asserts that the TS input type and the valibot output type agree on the serializable keys, so they cannot drift.
