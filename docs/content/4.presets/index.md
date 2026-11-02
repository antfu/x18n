---
title: Presets
description: The built-in presets, how x18n detects them, and the placeholders and extraction templates they add.
---

A preset is a group of plugins for one i18n library. It tells x18n which calls are translate calls, how namespaces work, which placeholder syntax the messages use, and which code replaces a hard string.

| Preset | Library | Detected from |
| --- | --- | --- |
| [`nuxt-i18n`](/presets/nuxt-i18n) | @nuxtjs/i18n | `@nuxtjs/i18n`, `nuxt-i18n` |
| [`nuxt-i18n-micro`](/presets/nuxt-i18n-micro) | Nuxt I18n Micro | `nuxt-i18n-micro` |
| [`vue-i18n`](/presets/vue-i18n) | vue-i18n | `vue-i18n`, `vuex-i18n`, `petite-vue-i18n`, `vue-i18n-bridge`, `@intlify/*` |
| [`fluent-vue`](/presets/fluent-vue) | fluent-vue | `fluent-vue`, `fluent-vue-loader`, `rollup-plugin-fluent-vue`, `unplugin-fluent-vue` |
| [`fluent-react`](/presets/fluent-react) | @fluent/react | `@fluent/react` |
| [`i18next-shopify`](/presets/i18next-shopify) | i18next-shopify | `@shopify/i18next-shopify` |
| [`react-i18next`](/presets/react-i18next) | react-i18next | `react-i18next`, `next-i18next` |
| [`svelte-i18next`](/presets/svelte-i18next) | svelte-i18next | `svelte-i18next` |
| [`next-translate`](/presets/next-translate) | next-translate | `next-translate` |
| [`next-international`](/presets/next-international) | next-international | `next-international` |
| [`i18next`](/presets/i18next) | i18next | `i18next` |
| [`next-intl`](/presets/next-intl) | next-intl | `next-intl`, `use-intl` |
| [`react-intl`](/presets/react-intl) | react-intl (FormatJS) | `react-intl`, `@formatjs/*` |
| [`svelte-i18n`](/presets/svelte-i18n) | svelte-i18n, sveltekit-i18n | `svelte-i18n`, `sveltekit-i18n`, `@sveltekit-i18n/base` |
| [`solid-primitives-i18n`](/presets/solid-primitives-i18n) | @solid-primitives/i18n | `@solid-primitives/i18n` |
| [`paraglide`](/presets/paraglide) | Paraglide JS | `@inlang/paraglide-js`, `@inlang/paraglide-sveltekit`, `@inlang/paraglide-next`, `@inlang/paraglide-astro`, `@inlang/paraglide-vite` |
| [`gravity-ui-i18n`](/presets/gravity-ui-i18n) | @gravity-ui/i18n | `@gravity-ui/i18n` |
| [`typesafe-i18n`](/presets/typesafe-i18n) | typesafe-i18n | `typesafe-i18n` |
| [`angular-localize`](/presets/angular-localize) | @angular/localize | `@angular/localize` with an `i18n` block in `angular.json` |
| [`ngx-translate`](/presets/ngx-translate) | ngx-translate | `@ngx-translate/core` |
| [`transloco`](/presets/transloco) | Transloco | `@jsverse/transloco`, `@ngneat/transloco` |
| [`angular-i18next`](/presets/angular-i18next) | angular-i18next | `angular-i18next` |
| [`lingui`](/presets/lingui) | Lingui | `@lingui/core`, `@lingui/react`, `@lingui/macro` |
| [`ember-intl`](/presets/ember-intl) | ember-intl | `ember-intl` |
| [`polyglot`](/presets/polyglot) | Polyglot.js | `node-polyglot` |
| [`globalize`](/presets/globalize) | Globalize | `globalize` |
| [`i18n-tag`](/presets/i18n-tag) | es2015-i18n-tag | `es2015-i18n-tag` |
| [`ruby-i18n-js`](/presets/ruby-i18n-js) | i18n-js | `i18n-js` |
| [`ui5`](/presets/ui5) | SAPUI5, OpenUI5 | `@ui5/cli` |
| [`chrome-extension`](/presets/chrome-extension) | Chrome and WebExtension i18n | `default_locale` in `manifest.json`, `src/manifest.json` or `public/manifest.json` |
| [`vscode-extension`](/presets/vscode-extension) | VS Code extension API | `vscode`, `@types/vscode` |
| [`laravel-vue-i18n`](/presets/laravel-vue-i18n) | laravel-vue-i18n | `laravel-vue-i18n` |
| [`laravel`](/presets/laravel) | Laravel | `laravel/framework` in `composer.json` |
| [`php-joomla`](/presets/php-joomla) | Joomla | `joomla/application`, `joomla/cms` in `composer.json` |
| [`php-gettext`](/presets/php-gettext) | gettext in PHP | never: list it in `presets` |
| [`ruby-rails`](/presets/ruby-rails) | Ruby on Rails | `rails`, `rails-i18n`, `railties` in `Gemfile` |
| [`jekyll`](/presets/jekyll) | jekyll-multiple-languages-plugin | `jekyll-multiple-languages-plugin` in `Gemfile` |
| [`flutter`](/presets/flutter) | flutter_i18n | `flutter_i18n` in `pubspec.yaml` |
| [`easy-localization`](/presets/easy-localization) | easy_localization | `easy_localization` in `pubspec.yaml` |
| [`flutter-translate`](/presets/flutter-translate) | flutter_translate | `flutter_translate` in `pubspec.yaml` |
| [`python-gettext`](/presets/python-gettext) | gettext in Python: Django, Flask-Babel, Babel | `django`, `flask-babel` in `pyproject.toml` or `requirements.txt` |
| [`i18nice`](/presets/i18nice) | i18nice, python-i18n | `i18nice`, `python-i18n` in `pyproject.toml` or `requirements.txt` |
| [`cargo-i18n`](/presets/cargo-i18n) | cargo-i18n (Fluent) | `i18n-embed-fl`, `i18n-embed` in `Cargo.toml` |
| [`dotnet-resx`](/presets/dotnet-resx) | .NET `IStringLocalizer` and `.resx` resources | a `*.csproj`, `*.vbproj` or `*.fsproj` and a `*.resx` file |
| [`general`](/presets/general) | none | always |

## Detection

With the default `presets: 'auto'`, x18n tests each preset in the order of the table. Most presets apply when the project depends on one of the listed packages. x18n reads the dependencies, dev dependencies and peer dependencies in `package.json`, the dependencies in `composer.json`, `pubspec.yaml`, `Gemfile` and `Cargo.toml`, and the Python requirements in `pyproject.toml` (`[project]`, `[project.optional-dependencies]`, `[dependency-groups]` and the Poetry dependency tables) and `requirements.txt`. Python package names compare in their normalized form, so `Flask_Babel` is `flask-babel`. The manifests in the parent directories, up to the git root, count too.

More than one preset can apply. Some presets include the plugins of another preset: `react-i18next` and `svelte-i18next` include everything of `i18next`, and `i18next-shopify` includes everything of `react-i18next`. When two applied presets share a plugin, x18n adds that plugin one time.

A preset can be exclusive. When an exclusive preset applies, x18n tests no preset after it. `laravel` and `php-gettext` are exclusive. `php-gettext` has no detection, so it applies only when you list it.

Run `x18n doctor` to see the result. Each preset shows as `detected`, `not-detected`, `listed`, or `after-exclusive`.

## List presets

To pick the presets yourself, list them. x18n then applies exactly the listed presets and detects none:

::code-group

```ts [x18n.config.ts]
import { defineConfig } from '@x18n/core'

export default defineConfig({
  presets: ['vue-i18n', 'general'],
})
```

```yaml [x18n.config.yml]
presets: [vue-i18n, general]
```

::

The names are those in the first column of the table, in every config format. `presets: []` turns every preset off.

In TS, each preset is also a function in `@x18n/builtins/presets/<name>`, named in camelCase. Use it when a config builds on the preset object:

```ts [x18n.config.ts]
import { vueI18n } from '@x18n/builtins/presets/vue-i18n'
import { defineConfig } from '@x18n/core'

export default defineConfig({
  presets: [
    vueI18n()
  ],
})
```

## What a preset adds

Each preset page lists what the preset adds:

- Translate calls: the callee names that count as translate calls, and where the key, the namespace and the key prefix come from. These become `usage.calls`.
- Defaults: namespace rules, derived keys and resource patterns.
- Placeholders: the syntax of the placeholders in messages.
- Extraction templates: the code that replaces a hard string.

Your config adds to these defaults. For example, `usage.calls` in the config adds callees to the ones of the preset. See [How x18n merges the config](/guide/configuration#how-x18n-merges-the-config).

## Resource defaults

The resource patterns of all applied presets add up. For example, a project with `next-intl` and `ngx-translate` uses the patterns of both presets.

- If your config has `resources`, x18n uses only your patterns. They replace the patterns of every preset.
- If the patterns of the presets match no file, x18n guesses the locale directories, as it does without presets. See [Locale files](/guide/configuration#locale-files).
- A pattern without `{locale}`, such as `webapp/i18n/i18n.properties`, holds the source locale. To give it another locale, set `locale` on the resource.

## Placeholders

A placeholder syntax tells x18n how placeholders look in messages. The [`placeholder-mismatch`](/checks/placeholder-mismatch) check and `x18n apply` compare the placeholders of each translation with the source value. Translate prompts list them.

| Syntax | Example | Used by |
| --- | --- | --- |
| braces | `{name}`, `{0}` | vue-i18n, nuxt-i18n, nuxt-i18n-micro, i18next-shopify, next-international, ui5, vscode-extension, flutter, easy-localization, flutter-translate |
| positional braces | `{}` | easy-localization |
| linked | `@:key`, `@.lower:key` | vue-i18n, nuxt-i18n, easy-localization |
| typed braces | `{name}`, `{name:string}`, `{date\|weekday}` | typesafe-i18n |
| double braces | `{{name}}`, `{{name, format}}`, `{{- raw}}` | i18next, react-i18next, i18next-shopify, next-translate, gravity-ui-i18n, ngx-translate, transloco, flutter-translate |
| nesting | `$t(key)` | i18next, react-i18next, angular-i18next, i18next-shopify |
| ICU | `{name}`, `{count, plural, one {# item} other {# items}}` | next-intl, react-intl, svelte-i18n, lingui, ember-intl, globalize |
| fluent | `{ $name }` | fluent-vue, fluent-react |
| percent braces | `%{name}` | polyglot, ruby-i18n-js, ruby-rails, i18nice |
| printf | `%s`, `%d`, `%1$s` | php-joomla, php-gettext |
| Python percent | `%(name)s`, `%s`, `%d` | python-gettext |
| colon | `:name` | laravel |
| dollars | `$name$` | chrome-extension |
| dotnet | `{0}`, `{0:C}`, `{0,-10}`, `{name}` | dotnet-resx |
| angular | `{$INTERPOLATION}`, `{$START_LINK}` | angular-localize |

A linked message (`@:key`) and a nesting placeholder (`$t(key)`) name another key. That key then counts as used. The [`invalid-syntax`](/checks/invalid-syntax) check reports a linked message whose key does not exist, and ICU messages that do not parse or that lack an `other` case.

Plugins can use all of these syntaxes from `@x18n/builtins/placeholders`. A [YAML plugin](/plugins/yaml#sections-placeholders) can declare a shape such as `%{name}`.

## Extraction templates

`x18n extract` replaces a hard string with code from a template. A template has these tokens:

| Token | Becomes |
| --- | --- |
| `{key}` | The new key. |
| `{attr}` | The attribute name, for attribute kinds. |
| `{args}` | The arguments of a template string: `, { name: user.name }`, without the `, ` right after `(`. Empty when there are none. |
| `{text}` | The message of the hard string, as stored in the source locale: the original text, with the arguments of a template string as placeholders. Use it for a default value, as in `$t('{key}', '{text}')`. |
| `{source}` | The text of the hard string as written in the file, unchanged. Use it for markup that keeps the source around it. |
| `{parts}` | The message as the body of a template string, each argument as `${expression}:NAME:`, as `$localize` writes it. |

x18n escapes `{key}` and `{text}` for the quotes around them. Inside `'...'` or `"..."` it escapes backslashes, that quote and line breaks. Inside a template literal it escapes backslashes, backticks and `${`. Inside a quoted attribute, such as `:title="$t('{key}', '{text}')"`, it also writes `&` and the attribute quote as entities. Outside quotes the value goes in as is.

Each hard string has a kind, which tells where it is:

| Kind | Example |
| --- | --- |
| `jsx-text` | `<p>Hello</p>` in JSX |
| `jsx-attribute` | `<input placeholder="Search" />` in JSX |
| `vue-template-text` | Text in a Vue template |
| `vue-attribute` | An attribute in a Vue template |
| `svelte-text` | Text in a Svelte component |
| `svelte-attribute` | An attribute in a Svelte component |
| `astro-text` | Text in an Astro template |
| `astro-attribute` | An attribute in an Astro template |
| `html-text` | Text in an HTML or Angular template (`ngx-translate`, `transloco`, `angular-i18next`), or with no element of its own (`angular-localize`) |
| `html-element` | An Angular element with text, marked with `i18n` as one message (`angular-localize`) |
| `html-attribute` | An attribute in an HTML or Angular template |
| `dq-html-text`, `dq-html-element`, `dq-html-attribute` | The same in an inline Angular `template:` in double quotes, which takes `i18n='...'` (`angular-localize`) |
| `js-string` | A string literal in JS or TS |
| `js-template` | A template string in JS or TS |

x18n picks the first template that matches the kind (`kinds`) and the file (`files`). It tries the templates of `extract.templates` first, then those of the presets, then these defaults:

| Kinds | Template |
| --- | --- |
| `jsx-text`, `astro-text` | `{t('{key}'{args})}` |
| `jsx-attribute`, `astro-attribute` | `{attr}={t('{key}'{args})}` |
| `vue-template-text`, `html-text` | `{{ $t('{key}'{args}) }}` |
| `vue-attribute`, `html-attribute` | `:{attr}="$t('{key}'{args})"` |
| `svelte-text` | `{$t('{key}'{args})}` |
| `svelte-attribute` | `{attr}={$t('{key}'{args})}` |
| any | `t('{key}'{args})` |

A template can add `imports`: lines that x18n adds once to the file when they are missing, such as `import { useI18n } from 'vue-i18n'`.

```ts [x18n.config.ts]
import { defineConfig } from '@x18n/core'

export default defineConfig({
  extract: {
    keyPrefix: '{component}',
    templates: [
      {
        template: 'i18n.t(\'{key}\'{args})',
        kinds: ['js-string', 'js-template'],
        files: ['src/server/**'],
        imports: ['import { i18n } from \'~/i18n\''],
      },
    ],
  },
})
```
