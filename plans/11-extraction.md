# 11 - Extraction

Find hard-coded user-facing strings in source code and turn them into keys. Ported from i18n-ally `src/extraction` and `core/Extract.ts`, rebuilt on AST scanners.

## Pipeline

1. **Detect.** Extractors walk the same ASTs the scanners build (one parse per file) and return `HardString` candidates: text, range, kind (`js-string`, `js-template`, `jsx-text`, `jsx-attribute`, `html-text`, `html-attribute`, `vue-template-text`, `astro-text`, ...), and template arguments (`${name}` becomes `{name}` in the message, the expression is kept for the call).
2. **Score.** Rules return a score (`must-include`, `should-include`, `none`, `should-exclude`, `must-exclude`), folded like i18n-ally `shouldExtract`: a `must-*` wins at once, otherwise the last `should-*`. Built-in rules port the i18n-ally ones: spaces and letters, camelCase or SCREAMING_CASE (exclude), digits only (exclude), non-ASCII letters (include), URLs and paths (exclude), strings that already contain a translate call (exclude). Ignored contexts: `console.*`, `import` and `require` specifiers, object keys, type positions, `className`/`class`/`style`/`key`/`ref` attributes, configured ignored attributes and callees.
3. **Ignore lists.** Config `extract.ignore` (strings or regex) and per-file `extract.ignoreByFile`. The "ignore this string" code action writes there. Control comments work too: `x18n-ignore` (its line and the next), `x18n-ignore-start` ... `x18n-ignore-end` (a region), `x18n-ignore-file` (the whole file). Tests, fixtures, mocks, stories, configs and type declarations are never scanned, by the file and directory conventions of common languages.
4. **Plan.** For each accepted candidate:
   - **Key**:
     - Default: a bare camelCase slug with no prefix, as in i18n-ally ("Forgot password?" becomes `forgotPassword`).
     - Other strategies: `source`, `random`, `empty`.
     - Case styles: `camel`, `snake`, `kebab`, `dot`.
     - An optional prefix template with `{fileName}`, `{dirName}` or `{component}`.
     - A max length, and a numeric suffix when the key exists with a different text.
     - If the same text already exists as a value in the source locale, that key is reused (configurable).
   - **Target resource**: the new-key placement rule of [02-core.md](./02-core.md) (namespace, then longest prefix, then first resource).
   - **Replacement**: from refactor templates. Presets give templates per kind (vue-i18n: `{{ $t('{key}') }}` in templates, `t('{key}')` in script setup with `useI18n` present, `:{attr}="$t('{key}')"` for attributes). Config can add templates filtered by kind and file globs. When several templates apply, the plan has a decision. Tokens: `{key}`, `{attr}` (attribute name), `{args}` (template-string arguments) and `{text}` (the message, with arguments as placeholders, for a default value such as `$t('{key}', '{text}')`). `{key}` and `{text}` are escaped for the quotes around them (backslashes, the quote and line breaks in a JS string; backticks and `${` in a template literal; entities in a quoted attribute), because `source` keys and messages hold any text.
   - **Imports**: a template can require an import or a setup line (`const { t } = useI18n()`); the plan adds it once per file when missing, at the top of a `---` frontmatter (only when a closing `---` line exists) or of the first `<script>`, else after the last import.
5. **Apply.** One `project.plan([{ type: 'extract', items }])` call: source edits plus resource edits in one plan, so the LSP can return one `WorkspaceEdit`.

## Surfaces

- CLI: `x18n extract src/**/*.vue --list --json` gives candidates and proposed keys. `--plan out.json` writes the plan to a file; an agent or a human edits keys and templates; `x18n extract --apply out.json` applies it. Without flags in a TTY, an interactive review per string.
- LSP: diagnostics (`hard-string` check, off by default, on with `extract.autoDetect`), code actions "Extract to key", "Extract all in file", "Ignore".
- UI: `/extract` page with the same plan editing.
- MCP: `x18n_extract_plan`, `x18n_extract_apply`.

## Extractors per preset

| Preset | Kinds |
| --- | --- |
| `general` | js-string, js-template, jsx-text, jsx-attribute, html-text, html-attribute |
| `vue-i18n` | + vue-template-text, vue-attribute, vue bound attribute |
| `react-i18next`, `next-intl`, `react-intl` | jsx kinds with library templates (`t('{key}')`, `<FormattedMessage id="{key}" />`) |
| `svelte-i18n` | svelte text and attributes |
| any preset with translate calls, in `.astro` | astro-text, astro-attribute, js kinds in the frontmatter. Strings inside `{...}` expressions are not reported, nor strings in `<script>`: a replacement there would run in the browser, where the frontmatter import is not in scope, and `is:inline` scripts cannot import |
| `ngx-translate`, `transloco`, `angular-i18next`, in `.html` | html-text, html-attribute through the `html` scanner, which these presets add (a plain `index.html` in other apps is not scanned). Interpolations, bindings, control-flow block parameters, ICUs and elements marked with `translate`, `transloco` or `i18n` are not reported. Pipe templates: `{{ '{key}' \| translate }}`, `[{attr}]="'{key}' \| translate"` |
| `angular-localize`, in `.html` and inline `template:` strings | html-element, html-text, html-attribute from its own scanner, as `i18n` and `i18n-*` markup that keeps the source. js-string and js-template become `$localize`, with named placeholders. |
| `fluent-vue`, `next-international` | as in i18n-ally |
