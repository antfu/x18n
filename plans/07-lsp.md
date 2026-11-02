# 07 - Language server

Package `@x18n/lsp`, binary `x18n-lsp` (`--stdio`, `--node-ipc`, `--socket=<port>`). Built on `vscode-languageserver` and `vscode-languageserver-textdocument`. The server follows the LSP standard. VS Code is the only supported editor for 1.0; other editors are tested and documented in 1.x (M16). Features that need more than the standard use `x18n/*` requests, which other clients can ignore.

## Goal: keys behave like imported symbols

`t('xxx.yyy')` should feel like `import { xxxyyy } from './locales/en.js'`. Go to definition, find all usages and rename must be as reliable as they are for a TS symbol.

### Symbol model

- **In code, the whole key is the symbol.** Anywhere in `'xxx.yyy'`, definition, references and rename act on the key `xxx.yyy`. The rename box shows the full key, and the new name may change nesting or the namespace.
- **In resource files, the node under the cursor is the symbol.**
  - In `{ "pages": { "home": { "title": "..." } } }`, the cursor on `title` is the key `pages.home.title`.
  - The cursor on `home` is the subtree `pages.home.*`; the cursor on `pages` is the subtree `pages.*`.
  - In flat files (`{ "pages.home.title": "..." }`), the whole flat key is the symbol, the same as in code. Subtree rename for flat files is available through `x18n rename pages screens`.
- **The namespace is part of the key** (`common:save`).
- **Ranges** cover the key text only, inside the quotes, the same as TS's rename span.

### Definition, implementation, references

| Request | Result |
| --- | --- |
| `textDocument/definition` | The key's entry in the **source locale** resource: one location, like a TS import. On a parent node, the node in the source locale. |
| `textDocument/implementation` | The key's entry in **every locale's** resource, source first. |
| `textDocument/references` | All usages in code. Locale entries are not references; `textDocument/implementation` lists them. It works from a usage or from any resource entry. For a parent node, it returns usages of every key under it. Prefix usages (`t(`pages.${id}.title`)`) are included and labelled "possible" in the label or detail where the client allows it. |
| `textDocument/prepareRename` | The key range when the position is on a key or a resource node, else `null` so other providers keep working. |
| `textDocument/rename` | One `WorkspaceEdit` from the edit planner, following the rename rules in [02-core.md](./02-core.md): all locales, usages, dynamic prefixes and review threads, re-nesting with cleanup, namespace moves with file creation, refusal on conflict (error message lists the files), warnings for dynamic usages it cannot update. |

### Index

- At startup the server builds the full usage index in the background, with `$/progress`, like tsserver loading a project. The persistent cache makes warm starts fast.
- References and rename **wait for the index** instead of returning partial results.
- Open documents are re-scanned on `didChange` (debounced) without a save, through the overlay host. File events come from `workspace/didChangeWatchedFiles`.

## Other features

| LSP request | Behaviour | i18n-ally origin |
| --- | --- | --- |
| `textDocument/inlayHint` | Display-locale value after each key usage, truncated at `annotationMaxLength` (40). Missing values show in a warning style. Used when in-place mode is off, and for keys that in-place mode cannot cover. | `editor/annotation.ts` |
| `textDocument/hover` | Table of all locale values (with when each changed and an outdated mark, [19-history.md](./19-history.md)) and the number of usages. Command links (open in UI, copy translate prompt, translate with agent) appear only for the commands the client lists in `hoverCommands`: most clients (Zed, for one) open a `command:` URL as a link and fail. The VS Code extension lists all three. | `editor/hover.ts` |
| `textDocument/completion` | Keys at key slots reported by scanners, filtered by scope prefix. The item detail shows the source value. Trigger characters `.`, `'`, `"`, `` ` ``, `:`. | `editor/completion.ts` |
| `textDocument/publishDiagnostics` (pull diagnostics when supported) | **Exactly the diagnostics `x18n check` reports** for the file, with the same config. The only extra is `hard-string` when `extract.autoDetect` is on. | `editor/problems.ts` |
| `textDocument/codeAction` | Quick fixes from diagnostic `fixes`: add missing key, fill from source, extract string, ignore string, replace a selection with an existing key that has the same value. | `editor/refactor.ts`, `editor/extract.ts` |
| `textDocument/documentSymbol` | Key tree in resource files. | new |
| `workspace/symbol` | Search keys and values across the project. | new |
| `textDocument/codeLens` (opt-in) | In resource files: "used 3 times", "missing in de, fr". | new |
| `workspace/executeCommand` | `x18n.set`, `x18n.delete`, `x18n.deleteUnused`, `x18n.extract`, `x18n.renamePrefix`. | commands |

Hover and inlay hints inside resource files show the display-locale value next to the same key in another locale's file, as i18n-ally did.

## Custom protocol

All methods use the `x18n/` prefix. Shapes are valibot schemas shared with the client and versioned with the JSON contract of [06-cli.md](./06-cli.md).

| Method | Kind | Purpose |
| --- | --- | --- |
| `x18n/projects` | request | Active projects, locales, source locale. |
| `x18n/keyAt` | request | The key or resource node at a position, or `null`. The VS Code client uses it for TypeScript coexistence ([08-vscode.md](./08-vscode.md)). |
| `x18n/tree` | request | Key tree with coverage per node, for tree views. Lazy by parent key. |
| `x18n/progress` | request | Coverage per locale with missing and empty key lists. |
| `x18n/fileKeys` | request | Keys used in a document, keys not found, hard strings (Current File view). |
| `x18n/usageReport` | request | Unused and missing keys with locations, sorted by project and key. |
| `x18n/unusedDeletion` | request | Dry run of `x18n.deleteUnused`: per project, the keys with a location per message, the kept keys with the usages that keep them, and warnings. |
| `x18n/search` | request | Keys by value in any locale (fuzzy, or `exact`), best first, with the locale entry and the usages (reverse search). |
| `x18n/decorations` | request | Ranges, values and states for in-place annotations. |
| `x18n/setDisplayLocale` | notification | Per-client display locale. |
| `x18n/openUi` | request | Start or reuse the UI server for a project; returns `{ url, token }`. |
| `x18n/translatePrompt` | request | Prompt text for a locale or key set. |
| `x18n/reviews` | request | Review threads with their comments, state and the location of the key in the reviewed locale. |
| `x18n/explain` | request | The `x18n doctor` text for every workspace folder, with load errors. The server also logs it when it finds no locale files. |
| `x18n/changed` | server notification | Project revision and changed keys, so client views refresh only what changed. |

## Hosting the UI

`x18n/openUi` starts the devframe dev server from `@x18n/ui` inside the server process, on `127.0.0.1` and a free port, using the same `Project` instance. The UI and the editor see the same state and the same edits. Auth is always on: the response carries a client auth token that the VS Code webview passes in the URL fragment. The server stops the UI server when the last client disconnects, or on `shutdown`.

"Open in editor" actions in the UI call an RPC that the LSP turns into `window/showDocument`.

## Settings

The server reads editor UX settings from `initializationOptions`: `annotationMaxLength`, `displayLocale`, `codeLens`, `showFlags`, `hoverCommands`. `x18n/setDisplayLocale` changes the display locale later. Project settings live only in `x18n.config.ts`; editor settings never override them.

## Testing

- In-process tests: create the connection over `PassThrough` streams and drive it with JSON-RPC client messages, against fixture projects on a memory host. Cover definition, implementation, references (from both sides), rename (whole key, subtree, flat key, namespace move, conflict, dynamic warning), and diagnostics equal to `x18n check` output.
- One smoke test spawns the built binary over stdio.
