# 08 - VS Code extension

Package `packages/vscode`, published as **`antfu.x18n`** (display name "x18n") to the Marketplace and Open VSX. Built with `reactive-vscode`, types and meta from `vscode-ext-gen`, bundled by tsdown to CJS with `vscode` external, `--no-dependencies` packaging. Engine `^1.100.0`.

The extension holds no i18n logic. Everything comes from the LSP through standard and `x18n/*` requests.

## Package name and id

Turborepo refuses two workspace packages with the same name, and the CLI owns `@x18n/cli`. So the workspace package is `x18n-vscode`. The `ext:package` and `ext:publish` scripts write a staged copy to `.vsce/`, with `name: "x18n"` and without dev-only fields, then run `vsce` and `ovsx` on the `.vsix` built from it. Code never relies on the generated `extensionId` constant, which would read `antfu.x18n-vscode`.

## Activation

- `workspaceContains:**/x18n.config.*` and `workspaceContains:**/package.json` (the server then decides, and stays idle when nothing is detected), plus `onCommand:x18n.*`.
- Starts the bundled `x18n-lsp` with `vscode-languageclient` over node IPC. The document selector is broad (`file` scheme, all languages); the server ignores files it has no scanner or format for.

## Coexisting with TypeScript

Research (October 2026) found:
- VS Code merges definition and references from all providers.
- For rename, the first provider whose `prepareRename` accepts wins. Rejections fall through to the next one.
- tsserver accepts rename on string literals typed as a literal union, and then changes only those literals.
- TS 7 (the Go port) does not load tsserver plugins.

So there is no tsserver plugin. Instead:

1. **TS 6 tsserver (VS Code's built-in default).** Our rename provider, registered through the language client with `prepareRename`, sorts before the built-in TypeScript provider at equal score. A VS Code e2e test proves that rename on a typed key literal reaches x18n.
2. **TS 7 (`TypeScriptTeam.native-preview` active).** Through its `registerLspMiddleware` for `textDocument/prepareRename` and `textDocument/rename`, the extension asks the x18n LSP per request (`x18n/keyAt`). On a key, it nulls out TS's result so ours applies. The transformer is async, so no sync bridge is needed.
3. **References.** Client middleware drops locations that the TypeScript provider already reports, so the peek view shows no duplicates.
4. Our `prepareRename` returns `null` outside keys, so TS rename keeps working everywhere else.

## Features

| Feature | Built from |
| --- | --- |
| In-place annotations, **on by default** | `x18n/decorations` + `TextEditorDecorationType` (details below). |
| After-key hints | LSP inlay hints, when in-place is off and as its fallback. |
| Definition, implementation, references, rename, hover, completion, diagnostics, code actions | Standard LSP ([07-lsp.md](./07-lsp.md)). |
| Activity bar container with views **Current File, Progress, Keys, Usage Report** | `x18n/fileKeys`, `x18n/progress`, `x18n/tree`, `x18n/usageReport`. Refresh on `x18n/changed`. A Reviews view (`x18n/reviews`) lists threads with open comments. |
| Status bar: display locale | `x18n/projects`, `x18n/setDisplayLocale`. |
| x18n UI panel | Webview panel whose content is an `<iframe>` of `asExternalUri(url)` from `x18n/openUi`. |
| Key editor | The same UI, opened at the key route (`#/keys/<key>`), replacing the i18n-ally Vue 2 webview. |
| Rename key prefix | Command and code action on resource parent nodes (also the LSP's normal rename there). |
| Schema validation | `jsonValidation` for `x18n.config.json`; `yaml.schemas` for `x18n.config.y?(a)ml` and `*.x18n-plugin.y?(a)ml`. |
| Copy translate prompt | Command and hover link, through `x18n/translatePrompt`, to the clipboard. |
| Translate with agent | Command and hover link: the same prompt, sent to the editor's chat in agent mode (`workbench.action.chat.open`); the clipboard when that command is missing (D39). |
| i18n-ally migration | When `.vscode/settings.json` has `i18n-ally.*` keys and no x18n config exists, offer "Migrate from i18n-ally": it runs the migration through the server and shows the diff. |

### In-place annotations

On by default, like i18n-ally:
- In code files, including Vue and Svelte templates, the key text is hidden and the display-locale value is shown instead. Resource files never get in-place annotations.
- On the cursor line and inside selections, the raw key is revealed, so editing always shows the real text.
- When the value is missing, the key itself is shown in a warning color.
- Dynamic keys, and keys too long for the line, fall back to the after-key hint.
- `x18n.annotationInPlaceFullMatch` (i18n-ally-next): the value replaces the whole call, from `Decoration.expression`. Calls over several lines keep the key-only replacement.
- `x18n.theme.*` (i18n-ally): CSS colors and borders of in-place values and missing keys; empty uses theme colors.
- The display locale defaults to the source locale and can be switched from the status bar.

## Webview embedding

- The webview sets a CSP that allows `frame-src` of the external URI only.
- Theme: the iframe URL carries `?theme=dark|light|high-contrast`, and the webview script forwards VS Code theme changes to the iframe with `postMessage`. The UI accepts only messages from its parent with the expected shape.
- Language: the iframe URL carries `?lang=` with `vscode.env.language` (such as `zh-tw`), which the UI matches to its closest locale.
- In Remote, Codespaces and WSL, `asExternalUri` forwards the port. The server binds to loopback only.
- Auth: the token from `x18n/openUi` is passed in the URL fragment, which devframe reads as a magic link, so it never appears in requests or logs.

## Settings

Editor UX only. There are no project settings and no overrides of `x18n.config.ts`:
- `x18n.enabled`
- `x18n.annotations`
- `x18n.annotationInPlace` (default `true`)
- `x18n.annotationInPlaceFullMatch` (default `false`)
- `x18n.annotationMaxLength` (default 40)
- `x18n.displayLocale`
- `x18n.showFlags` (default `true`): circle-flags SVG icons in views and pickers, flag emoji in hovers and the status bar
- `x18n.theme.annotation`, `x18n.theme.annotationMissing`, `x18n.theme.annotationBorder`, `x18n.theme.annotationMissingBorder`, `x18n.theme.annotationInPlaceFullMatch`
- `x18n.codeLens`
- `x18n.trace.server`

## Commands

Generated into `src/generated/meta.ts` by `vscode-ext-gen` (`--scope x18n --locale`, so titles come from `package.nls.json`). Initial set:
- `x18n.findKeyByText` (reverse search over `x18n/search`; opens the usage, or the locale entry of an unused key)
- `x18n.openUi`, `x18n.openKey`, `x18n.setDisplayLocale`
- `x18n.editKey`, `x18n.renameKeyPrefix`, `x18n.deleteKey`
- `x18n.deleteUnusedKeys` (Usage Report title): shows the `x18n/unusedDeletion` dry run in a modal, then runs `x18n.deleteUnused`, an editor edit the user can undo
- `x18n.extract`, `x18n.extractFile`, `x18n.copyTranslatePrompt`, `x18n.translateWithAgent`
- `x18n.goToNextUsage`, `x18n.goToPrevUsage`
- `x18n.toggleInPlace`, `x18n.restartServer`, `x18n.migrateFromI18nAlly`, `x18n.showOutput`, `x18n.explainProjects` (prints `x18n/explain` to the output channel)

## Localization

The extension follows the VS Code display language, in the languages of the UI: `de`, `es`, `fr`, `ja`, `ko`, `pt-br`, `ru`, `tr`, `zh-cn`, `zh-tw` (VS Code locale ids), with English as the source.
- `package.json` strings are `%key%` references to `package.nls.json`, translated in `package.nls.<locale>.json`.
- Runtime strings go through `l10n.t` with `{0}` arguments, translated in `l10n/bundle.l10n.<locale>.json`. VS Code has no plural forms, so messages put counts after a label (`Usages: {0}`).
- Every runtime `l10n.t` of the extension is the one in `src/model/l10n.ts`, so `src/model` stays free of the `vscode` API. `src/language.ts` points it at `vscode.l10n.t`, or, when `x18n.language` names a language, at that language's bundle, and reloads the views when the setting changes. Command titles and setting descriptions always follow VS Code's display language.
- The output channel stays English. Terms follow the UI's own locales.
- The root `x18n.config.ts` lists `packages/vscode` as a project with the `vscode-extension` preset, so `x18n check --strict` checks these files, and a unit test checks that every message exists in every locale.

## Testing

- Unit tests for view models with a fake language client.
- `@vscode/test-electron` e2e on one fixture:
  - activation
  - an in-place decoration
  - rename on a typed key literal reaches x18n with tsserver active
  - references show no duplicates
  - the UI panel opens
