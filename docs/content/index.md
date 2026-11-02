---
navigation: false
title: 'x18n: i18n files, checked and maintained'
description: x18n reads the locale files of any project, finds where each key is used, and reports missing, unused and broken keys. A CLI, a language server, a VS Code extension, a UI and MCP tools share one engine.
---

<!-- eslint-disable markdown/no-missing-atx-heading-space -- `#title` and the like are MDC slot names, not headings. -->

::landing-hero
---
orientation: horizontal
---
::x18n-demo
::

#title
i18n files, checked and maintained

#description
x18n reads the locale files and the translate calls of your project. It reports missing, unused and broken keys, and changes locale files without breaking their format. For humans, CI and coding agents.

#links
  :::button
  ---
  to: /guide/getting-started
  size: lg
  trailing-icon: i-ph-arrow-right
  ---
  Get started
  :::

  :::button
  ---
  icon: i-simple-icons-github
  color: neutral
  variant: ghost
  size: lg
  to: https://github.com/x18n-dev/x18n
  target: _blank
  ---
  View on GitHub
  :::
::


::x18n-frameworks
::

::landing-tabs
---
items:
  - icon: i-ph-list-duotone
    title: x18n
    description: The status of the project. Locales with coverage, and the counts of resources, keys and usages.
  - icon: i-ph-check-circle
    title: x18n check
    description: Missing, unused and broken keys, like `tsc --noEmit`. Exits with 1 on errors.
  - icon: i-ph-magnifying-glass-duotone
    title: x18n get
    description: The value of a key in every locale, and where the code uses it.
  - icon: i-ph-text-aa-duotone
    title: x18n search
    description: Find the key behind a text that the app shows, in any locale, and where the code uses it.
  - icon: i-ph-pencil-simple-line-duotone
    title: x18n rename
    description: Rename a key in every locale and every usage. Add `--dry-run` to see the diff first.
  - icon: i-ph-table-duotone
    title: x18n ui
    description: Browse and edit every key in the browser. It serves MCP for agents at the same time.
  - icon: i-ph-file-code-duotone
    title: x18n init
    description: Write x18n.config.ts from the detected presets and locale files.
---

#headline
Quick start

#title
No config to start

#description
Run x18n in the root of a project. It detects the i18n library from your dependencies and finds the locale files. [Read the guide](/guide/getting-started).

#code-0
  :x18n-terminal{name="status"}

#code-1
  :x18n-terminal{name="check"}

#code-2
  :x18n-terminal{name="get"}

#code-3
  :x18n-terminal{name="search"}

#code-4
  :x18n-terminal{name="rename"}

#code-5
  :x18n-terminal{name="ui"}

#code-6
  :x18n-terminal{name="init"}
::


::landing-features
#headline
Surfaces

#title
One engine, every place you work

#description
Every surface reads the same config and reports the same diagnostics. The CLI in CI, the editor and the UI always agree.

#default
  :::landing-feature-card{icon="i-ph-terminal-window-duotone" to="/surfaces/cli"}
  #title
  CLI and x18n check

  #description
  `x18n check` reports invalid, untranslated and unused keys like `tsc --noEmit`. Every command has JSON output.
  :::

  :::landing-feature-card{icon="i-ph-code-duotone" to="/surfaces/vscode"}
  #title
  VS Code

  #description
  Translations in place of keys, go to definition, find references and rename across code and every locale file.
  :::

  :::landing-feature-card{icon="i-ph-table-duotone" to="/surfaces/ui"}
  #title
  UI

  #description
  Every key across every locale in one table. Edit values in the browser, or publish a static, read-only report.
  :::

  :::landing-feature-card{icon="i-ph-robot-duotone" to="/agents/workflows"}
  #title
  Agents

  #description
  Translate prompts, safe write commands and MCP tools let an agent translate, check and clean up messages.
  :::

  :::landing-feature-card{icon="i-ph-package-duotone" to="/presets"}
  #title
  Presets

  #description
  One preset for each framework of i18n-ally, detected from your dependencies: vue-i18n, i18next, next-intl, ngx-translate, Laravel, Rails, Flutter and 21 others.
  :::

  :::landing-feature-card{icon="i-ph-puzzle-piece-duotone" to="/plugins"}
  #title
  Plugins

  #description
  Add a library, a file format or a check with a YAML file, or with a typed TypeScript plugin.
  :::
::

::landing-cta
#title
Coming from i18n-ally?

#description
`x18n migrate i18n-ally` converts your settings and custom frameworks into an x18n config.

#links
  :::button
  ---
  to: /guide/getting-started
  size: lg
  trailing-icon: i-ph-arrow-right
  ---
  Get started
  :::

  :::button
  ---
  to: /migration
  color: neutral
  variant: subtle
  size: lg
  ---
  Migrate from i18n-ally
  :::
::
