# Zed `workspaceFolders` and x18n

When `@x18n/lsp` logs `No workspace folder is open.` with a folder already open in Zed, `initialize` was sent with `workspaceFolders: []`. That is not the same as omitting `workspaceFolders`.

In `@x18n/lsp` before 0.1.5 (`dist/src.mjs`):

```javascript
const folders =
  params.workspaceFolders?.map((folder) => fileURLToPath(folder.uri))
  ?? (params.rootUri ? [fileURLToPath(params.rootUri)] : []);
```

`[]` is not `null`/`undefined`, so the `?? rootUri` fallback never ran.

## What other Zed extensions do

[biome-zed](https://github.com/biomejs/biome-zed) and [zed-i18n-lens](https://github.com/yizixu/zed-i18n-lens) implement `language_server_command` (and settings). They do not rewrite LSP traffic. Zed builds `initialize` in `LanguageServer::default_initialize_params` (`crates/lsp/src/lsp.rs`):

- No shared workspace-folder set: one folder from `root_uri`.
- A shared set that is still empty at init: `workspaceFolders: []` even when `rootUri` is set.

Zed may later send `didChangeWorkspaceFolders`. `@x18n/lsp` 0.1.x does not handle that notification.

This is a client/server contract mismatch, not missing wiring in the Rust extension. There is no Zed extension API to override `initialize.workspaceFolders`.

## What this extension does

From `@x18n/lsp` 0.1.5 onward, empty `workspaceFolders` is treated like missing folders and `rootUri` is used when the folder list would otherwise be empty.

The Zed extension also passes `worktreeRoot` in initialization options (Zed `worktree.root_path()`). That helps when a future `@x18n/lsp` prefers it over a misleading `rootUri`. It does not patch the language server package.

Use `@x18n/lsp` 0.1.5 or newer in the workspace or via `serverVersion` / the extension-managed npm install.

## Upstream

Possible upstream fixes:

- **Zed**: when `pending_workspace_folders` is empty at init, fall back to `root_uri` instead of sending `[]`.

An `x18n.config.*` file is not required for the language server to start. Projects configured only via `.vscode/settings.json` (including i18n-ally presets) are valid once the project folder is visible to `@x18n/lsp`.
