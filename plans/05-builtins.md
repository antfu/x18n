# 05 - Built-in plugins

`@x18n/builtins` holds every built-in plugin and preset, with tree-shakable subpath exports:

```
@x18n/builtins/formats    the `formats` loader map; one module per format: formats/json, formats/yaml, ...
@x18n/builtins/finders    pattern(), sfcBlocks()
@x18n/builtins/scanners   the `scanners` loader map; scanners/js, scanners/vue, scanners/regex, scanners/regex-scopes, ...
@x18n/builtins/extractors ...
@x18n/builtins/checks     recommended() and each check
@x18n/builtins/reporters  the `reporters` loader map; reporters/pretty, reporters/json, ...
@x18n/builtins/presets    the `presets` loader map; one module per preset: presets/vue-i18n, presets/i18next, ...
```

Formats, scanners, reporters and presets are maps, so a consumer loads only what it uses. A preset is a folder: `entry.ts` (detection plus a `load`) is always loaded and `index.ts` (the preset) is imported only after detection passes. Formats and scanners are folders too: `entry.ts` holds `{ extensions, load }` and the module loads when a file of that format is first read, or a file it scans is first scanned. `regex` is always loaded. Each module exports its factory by name and as `default`. `createBuiltins()` is async because it loads the reporters, which are always on. Files in a `shared/` folder are not entries. The entry modules are bundled apart, so `index.ts` imports the maps through the package name and tsdown leaves those imports external.

`@x18n/cli` re-exports the preset factories as `@x18n/cli/presets`. Docs show preset names (`presets: ['vue-i18n']`) first, and `@x18n/builtins/presets/<name>` for the factories: `@x18n/node` aliases each of those subpaths and `@x18n/core` to its own copies, so a config needs no project install.

Tiers decide the release: tier 1 ships in 1.0 with full parity tests, tier 2 in 1.x (M15), tier 3 when someone asks.

## Formats

| Id | Extensions | Read | Write | Library | Tier |
| --- | --- | --- | --- | --- | --- |
| `json` | json | yes | in place | `jsonc-parser` to read, shared literal editor to write | 1 |
| `jsonc` | jsonc | yes | in place | `jsonc-parser` | 1 |
| `json5` | json5 | yes | in place | `json5` to read, shared literal editor to write | 1 |
| `yaml` | yml, yaml | yes | in place, keeps comments | `yaml` v2 Document API | 1 |
| `po` | po, pot | yes | in place | `pofile` or a small own parser | 2 |
| `properties` | properties | yes | in place | own line-based parser | 2 |
| `ftl` | ftl | yes | in place | `@fluent/syntax` | 2 |
| `arb` | arb | yes | in place (json) | json + `@@locale` and `@key` metadata | 2 |
| `js` / `ts` | js, mjs, cjs, ts, mts | static by default: `export default { ... }`, object literals, `defineX({ ... })` and loaders that only return one, bare or wrapped (`export default () => ({ ... })`, `defineI18nLocale(() => ({ ... }))`); executed with `execute: true` | in place when static; read-only when executed | `oxc-parser` to read, shared literal editor to write | 2 |
| `php` | php | static `return [ ... ]` arrays | in place | own parser, shared literal editor | 2 |
| `xliff` | xlf, xliff | yes | in place | small XML parser | 3 |
| `ini` | ini | yes | in place | own parser | 3 |
| `strings` | strings (Apple) | yes | in place | own parser | 3 |
| `android-xml` | xml (`res/values*/strings.xml`) | yes | in place | small XML parser | 3 |
| `resx` | resx | yes | in place | own parser | 2 |

`json`, `jsonc`, `json5`, `js` and `php` share one editor for nested key-value literals (`formats/shared/literal.ts`). It sets a value in its own quotes, adds a key after the last key of its parent in the file's indent and comma style, and deletes a key with its own lines, so every comment that is not on those lines stays.

By default the `js` / `ts` format never runs user code. A file that is not a static literal is reported as `X18N2004`, with a hint to use JSON or YAML or to opt in to execution.

Execution is opt-in per resource pattern (`resources: [{ pattern: 'src/locales/{locale}.ts', execute: true }]`):
- It runs in Node only, through the same loader as `x18n.config.ts`, and re-runs on change.
- Executed resources are read-only, because computed values cannot be written back. A write fails with a coded error naming the resource.
- In the browser, executed resources are skipped with a notice.

## Locale finders

| Id | What it finds |
| --- | --- |
| `pattern` | Files that match `resources[].pattern` (tokens in [03-plugins.md](./03-plugins.md)). |
| `sfc-blocks` | Vue `<i18n>` blocks (with `lang`, `locale` and `src` attributes; a `src` file is the resource, relative to the `.vue` file; a `src` outside the project or not in JSON, JSON5 or YAML is skipped) and fluent-vue `<fluent>` blocks. |
| `nls` | VS Code extension `package.nls.json` / `package.nls.{locale}.json`. |

## Scanners

| Id | Extensions | Engine |
| --- | --- | --- |
| `js` | js, jsx, mjs, cjs, ts, tsx, mts, cts | `oxc-parser` (native in Node, `@oxc-parser/wasm` in the browser), driven by call specs |
| `vue` | vue | `@vue/compiler-sfc` + `js` |
| `svelte` | svelte | `svelte/compiler` + `js` (Node only at first) |
| `astro` | astro | small template tokenizer + `js` for the frontmatter, `<script>` and `{...}` expressions |
| `html` | html, and attributes inside other templates | small HTML tokenizer |
| `regex` | any configured | RegExp, i18n-ally compatible |

Other languages (PHP, Ruby, Dart, Python, C#, Blade, ERB, Razor, Django and Jinja templates) start with `regex` scanners in their presets, with the i18n-ally patterns. AST scanners for them are tier 3.

## Presets

Detection uses the dependencies listed. "Parity" means the i18n-ally framework with the same name works with this preset, checked by the fixture tests in [15-quality.md](./15-quality.md).

| Preset | Detect | Adds | Tier |
| --- | --- | --- | --- |
| `vue-i18n` | vue-i18n, vuex-i18n, @intlify/*, petite-vue-i18n | `$t`, `t`, `tc`, `te`, `d`, `n`, `v-t`, `<i18n-t>`, `useI18n` factory, linked messages `@:key`, `sfc-blocks` | 1 |
| `nuxt-i18n` | @nuxtjs/i18n | `vue-i18n` + Nuxt `langDir` from `nuxt.config` when static, `i18n/locales` default | 1 |
| `nuxt-i18n-micro` | nuxt-i18n-micro | `$t`, `$ts`, `$tc`, `$has`, `useI18n` / `useNuxtApp` factories, `translationDir` from `nuxt.config` (`locales` default), page files as `pages.{route}` keys that a page component's usages prefer over global keys | 2 |
| `i18next` | i18next | `t`, the selector form `t($ => $.a.b)`, namespaces `ns:key` (folder namespaces keep `/`), plural and context suffixes, `{{x}}` placeholders; reads an i18next-cli `i18next.config.*` statically (locales, output pattern, namespaces, extra calls, ignore) | 1 |
| `react-i18next` | react-i18next, next-i18next | `i18next` + `useTranslation(ns)` factory, `<Trans i18nKey>`, `<Translation>` render prop, `withTranslation(ns)` for the whole file, `keyPrefix` on all three factories | 1 |
| `next-intl` | next-intl | `useTranslations(ns)` / `getTranslations` factories, `t.rich`, `t.markup`, `t.raw`, ICU placeholders | 1 |
| `react-intl` | react-intl, @formatjs/* | `formatMessage({ id })`, `<FormattedMessage id>`, `defineMessages`, ICU | 1 |
| `svelte-i18n` | svelte-i18n | `$_`, `$t`, `$format` | 1 |
| `vscode-extension` | vscode, @types/vscode | `nls` finder, `%key%` in `package.json`, `l10n.t` | 1 |
| `general` | always last | hard-string extraction for JS/TS/HTML, no scanners | 1 |
| `sveltekit-i18n` | sveltekit-i18n | `$t` | 2 |
| `svelte-i18next` | svelte-i18next | `i18next` + `$i18n.t` store calls, Svelte templates | 2 |
| `next-international` | next-international | `useI18n`, `useScopedI18n(scope)` | 2 |
| `next-translate` | next-translate | `{locale}/{namespace}.json`, `ns:key` | 2 |
| `ngx-translate` | @ngx-translate/core | `translate` pipe, `instant`, `get`, `[translate]` | 2 |
| `transloco` | @jsverse/transloco, @ngneat/transloco | pipe, directive, `*transloco="let t; read: 'scope'"` scopes, camelCase scope folders as key prefixes | 2 |
| `lingui` | @lingui/core | `po` format, `{locale}/messages.po`, `t` macro, `<Trans>` | 2 |
| `fluent-vue` | fluent-vue | `ftl` format, `$t`, `<fluent>` blocks | 2 |
| `fluent-react` | @fluent/react | `ftl` format, `<Localized id>`, `l10n.getString`, `props.getString` from `withLocalization`, attributes through `attrs` | 2 |
| `paraglide` | @inlang/paraglide-js | `messages/{locale}.json`, `m.key()` accessor calls | 2 |
| `gravity-ui-i18n` | @gravity-ui/i18n | `i18n.i18n(keyset, key)`, `i18n.keyset(keyset)` and `i18n.bind(null, keyset)` with the keyset as key prefix, `{namespaces}/{locale}.json` keyset folders, CLDR plural objects, `{{x}}` placeholders | 2 |
| `typesafe-i18n` | typesafe-i18n | `src/i18n/{locale}/index.ts` and `{locale}/{namespace}/index.ts` through the `js` format, `LL.a.b()` and `$LL.a.b()` accessor calls (regex), `{name:type\|formatter}` placeholders | 2 |
| `laravel` | composer: laravel/framework | `php` format, `lang/{locale}/{namespace}.php`, `__()`, `trans()`, `@lang` | 2 |
| `laravel-vue-i18n` | laravel-vue-i18n | `laravel` resources and keys, `trans()`, `wTrans()`, `transChoice()`, `$t()`, `$tChoice()`; `keygen: 'source'`, ignores the `php_{locale}` files of the Vite plugin; listed before the exclusive `laravel` so both apply | 2 |
| `ruby-rails` | Gemfile: rails | `yaml` with top-level locale transform, `t('.lazy')` from view path | 2 |
| `flutter` | pubspec: flutter_localizations, intl, flutter_i18n | `arb` format, `AppLocalizations.of(context).key` | 2 |
| `easy-localization` | pubspec: easy_localization | `assets/translations/{locale}`, `'key'.tr()`, `tr`, `plural`, `context.tr`, nested plural and gender keys, `{}` placeholders | 2 |
| `flutter-translate` | pubspec: flutter_translate | `assets/i18n/{locale}`, `translate`, `translatePlural`, nested plural keys | 2 |
| `python-gettext` | pyproject / requirements: django, flask-babel | `po` format, `locale/{locale}/LC_MESSAGES/*.po`, `_()`, `gettext()`, `ngettext()`, Django `{% translate %}`, source-message keys | 2 |
| `i18nice` | pyproject / requirements: i18nice, python-i18n | `{namespaces}.{locale}.yml` with top-level locale transform, `i18n.t()`, `%{name}` | 2 |
| `cargo-i18n` | Cargo.toml: i18n-embed-fl, i18n-embed | `ftl`, `fallback_language` and `assets_dir` from `i18n.toml`, `{assets_dir}/{locale}/*.ftl`, `fl!` macro | 2 |
| `dotnet-resx` | a `*.csproj`, `*.vbproj` or `*.fsproj` and a `*.resx` | `resx` format, `Name.resx` (source) and `Name.{locale}.resx`, `Localizer["key"]`, `GetString("key")`, `Resources.Key` | 2 |
| `chrome-extension` | manifest.json with `default_locale` | `_locales/{locale}/messages.json`, `.message` transform, `chrome.i18n.getMessage` | 2 |
| `angular` | @angular/localize | `xliff`, `$localize` | 3 |
| `ember-intl` | ember-intl | `t` helper | 3 |
| `polyglot`, `globalize`, `i18n-tag`, `ui5`, `php-gettext`, `php-joomla`, `jekyll`, `ruby-i18n-js` | as in i18n-ally | port of the i18n-ally definition | 3 |

## Checks

`x18n check` and the editor report the same diagnostics ([06-cli.md](./06-cli.md), [07-lsp.md](./07-lsp.md)). "Invalid", "untranslated" and "unused" keys map to these checks:

| Id | `recommended` | Reports |
| --- | --- | --- |
| `missing-key` | error | Invalid key: a usage whose key is not defined in the source locale. |
| `invalid-syntax` | error | Message syntax errors (ICU, vue-i18n linked messages, i18next nesting). |
| `placeholder-mismatch` | error | Target value placeholders differ from the source value. |
| `param-mismatch` | warning | A translate call whose params (`t('greet', { name })`) differ from the placeholders of the source message. Skips calls whose params are not a plain object literal. |
| `key-conflict` | error | A key is both a leaf and a parent (`a` and `a.b`), or is duplicated across files of the same locale and namespace. |
| `stale-translation` | warning | A target message that last changed before its source message, by the history providers ([19-history.md](./19-history.md)). |
| `missing-translation` | warning | Untranslated: a source-locale key that target locales lack. One diagnostic per key, at the source entry, listing the missing locales. |
| `empty-translation` | warning | Untranslated: an empty string value. |
| `redundant-translation` | warning | A message in a locale with a fallback (`localeFallbacks`) that equals the message it falls back to. The fix deletes it. |
| `unused-key` | warning | A key with no usage, after `keysInUse`, derived keys and dynamic prefixes. Skipped when the project has no scanners. |
| `locale-code-conflict` | warning | Two locale codes that differ only in spelling (`zh_CN` and `zh-CN`). |
| `dynamic-key` | off | A fully dynamic key (`t(key)`) that no check can follow. Off: a dynamic key is a legitimate pattern, and nothing in the message files fixes it. |
| `identical-to-source` | info | Target equals source (often untranslated copy). Skips locales of the source language, values without letters once placeholders and tags are removed, URLs, e-mail addresses, short all-caps words and `doNotTranslate` glossary terms. Info, not warning: cognates ("Plugins" in German) still match, and `strict` must not fail on them. |
| `key-style` | off | Key does not match a naming rule (options: `case`, `pattern`). Off: without options it has no rule, and the array form that sets them also sets the severity. |
| `hard-string` | off | Detected hard-coded string; on with `extract.autoDetect` ([11-extraction.md](./11-extraction.md)). |
| `glossary` | warning | A glossary term is translated differently from the glossary. Reports nothing without `translations` or `doNotTranslate` entries. |
| `typegen-stale` | error (1.x) | The generated `x18n.d.ts` is out of date ([18-typegen.md](./18-typegen.md)). |
| `review-changes-requested` | info | An open "request change" review ([12-reviews.md](./12-reviews.md)). |

`strict` (config `strict: true` or `x18n check --strict`) turns every warning into an error.

## Reporters

| Id | Output | Use |
| --- | --- | --- |
| `pretty` | `path:line:col`, then a severity badge with the message and check id, and a code frame with one line of context each side, then a `✖ N errors  ⚠ N warnings  N files` summary ("Found no errors." when clean) | Humans |
| `json` | The versioned JSON contract of [06-cli.md](./06-cli.md) | Tools, agents |
| `markdown` | Summary and tables | PR comments, agent context |
| `github` | `::error file=...` workflow commands | GitHub Actions annotations |
| `sarif` | SARIF 2.1.0 | Code scanning |
