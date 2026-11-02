---
title: What is x18n
description: x18n reads the i18n setup of a project, reports problems in its locale files and changes them safely.
---

x18n reads the i18n setup of a project: the locale files, and the translate calls in the code. It shows every key across locales, finds where each key is used, and reports keys that are missing, unused or broken. It also changes locale files for you, without breaking their format.

## The problem

Locale files drift as a project grows:

- A key exists in English but not in German.
- A key stays in the files after the code stops using it.
- A translation drops a placeholder, so `Hello {name}` becomes `Hallo`.
- Hard-coded text gets into the UI without a key.

[i18n-ally](https://github.com/lokalise/i18n-ally) found many of these problems inside VS Code. Its logic is tied to the VS Code API, so it cannot run in CI, in a browser or for a coding agent. x18n moves the same logic into an engine that runs anywhere.

## One engine, many surfaces

The engine is `@x18n/core`. It does no file access itself and knows no editor. A surface is a layer that people or tools use on top of the engine:

- The [CLI](/surfaces/cli) is for humans, CI and agents. `x18n check` does for i18n what `tsc --noEmit` does for types.
- The [VS Code extension](/surfaces/vscode) shows translations in place and treats keys like symbols: go to definition, find references and rename.
- The [language server](/references/lsp-protocol) gives the same features to any editor with an LSP client.
- The [UI](/surfaces/ui) shows every key across locales in a table. It runs as a local server, or as a static report.
- The [MCP server](/agents/mcp) gives the same tools to coding agents.

Every surface reads the same config and reports the same diagnostics. A fix that you make in the editor shows in the UI, and `x18n check` in CI agrees with both.

## Libraries and formats

::x18n-frameworks
::

x18n knows no i18n library and no file format by itself. Plugins add that knowledge. A preset is a group of plugins for one library. x18n detects the presets from the dependencies of the project:

- Vue: [vue-i18n](/presets/vue-i18n), [@nuxtjs/i18n](/presets/nuxt-i18n), [Nuxt I18n Micro](/presets/nuxt-i18n-micro), [fluent-vue](/presets/fluent-vue) and [laravel-vue-i18n](/presets/laravel-vue-i18n)
- React and Next.js: [i18next](/presets/i18next), [react-i18next](/presets/react-i18next), [i18next-shopify](/presets/i18next-shopify), [next-intl](/presets/next-intl), [next-translate](/presets/next-translate), [next-international](/presets/next-international), [react-intl](/presets/react-intl), [Lingui](/presets/lingui) and [@fluent/react](/presets/fluent-react)
- Svelte: [svelte-i18n and sveltekit-i18n](/presets/svelte-i18n) and [svelte-i18next](/presets/svelte-i18next)
- Astro: [i18next](/presets/i18next) (also with astro-i18next) and [Paraglide](/presets/paraglide)
- Solid: [@solid-primitives/i18n](/presets/solid-primitives-i18n)
- Paraglide JS: [Paraglide](/presets/paraglide)
- Gravity UI: [@gravity-ui/i18n](/presets/gravity-ui-i18n)
- typesafe-i18n: [typesafe-i18n](/presets/typesafe-i18n)
- Angular: [@angular/localize](/presets/angular-localize), [ngx-translate](/presets/ngx-translate), [Transloco](/presets/transloco) and [angular-i18next](/presets/angular-i18next)
- Other JS libraries: [ember-intl](/presets/ember-intl), [Polyglot.js](/presets/polyglot), [Globalize](/presets/globalize), [es2015-i18n-tag](/presets/i18n-tag), [i18n-js](/presets/ruby-i18n-js) and [UI5](/presets/ui5)
- Extensions: [Chrome and WebExtensions](/presets/chrome-extension) and [VS Code](/presets/vscode-extension) (`vscode.l10n` and `package.nls.json`)
- PHP: [Laravel](/presets/laravel), [Joomla](/presets/php-joomla) and [gettext](/presets/php-gettext)
- Ruby: [Rails](/presets/ruby-rails) and [Jekyll](/presets/jekyll)
- Dart: [flutter_i18n](/presets/flutter), [easy_localization](/presets/easy-localization) and [flutter_translate](/presets/flutter-translate)
- Python: [gettext](/presets/python-gettext) (Django, Flask-Babel, Babel) and [i18nice](/presets/i18nice) (also python-i18n)
- Rust: [cargo-i18n](/presets/cargo-i18n) (Fluent)
- .NET: [`.resx` resources](/presets/dotnet-resx) in C#, Razor and Blazor

The built-in formats read JSON, JSONC, JSON5, YAML, gettext PO, Java properties, Fluent FTL, INI, PHP arrays, .NET resx, XLIFF, XMB and XTB, ARB and static JS or TS modules. They also read Vue `<i18n>` and `<fluent>` blocks. For a library or format that x18n does not support, [write a plugin](/plugins) in YAML or TypeScript.

## What x18n does not do

- It does not call machine translation services. Instead, it writes a [translate prompt](/agents/prompts) for an agent or an LLM, and checks the result.
- It is not a runtime i18n library. It reads and writes the files that your runtime library uses.
- It has no hosted service, no account and no telemetry.
- It does not run your source files or locale files. It parses them. Only a TS or JS config file and TS plugins run.

## Packages

| Package | Contents |
| --- | --- |
| `@x18n/cli` | The CLI. |
| `@x18n/core` | The engine: domain model, plugin API, analysis, and `defineConfig`. |
| `@x18n/builtins` | The built-in plugins and presets. |
| `@x18n/node` | Config loading and file access in Node. |
| `@x18n/lsp` | The language server. |
| `@x18n/ui` | The UI. |
| `x18n-vscode` | The VS Code extension. |
