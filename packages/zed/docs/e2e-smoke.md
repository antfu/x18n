# Local end-to-end smoke checklist (Zed + x18n)

Use this after installing the dev extension. Package checks run Node tests, Rust tests, Clippy, and the WASM build. Zed behavior needs a manual check.

## Prerequisites

- [ ] Node.js **22+** (`node -v`)
- [ ] Rust **stable** with `wasm32-wasip2` (`rustup target add wasm32-wasip2`)
- [ ] Zed with **Install Dev Extension** (`packages/zed`)
- [ ] A project with locale resources. `x18n.config.*` is optional, and i18n-ally / `.vscode/settings.json` layouts work.

If Zed.log showed `No workspace folder is open.`, see [workspace-folders.md](./workspace-folders.md). Use `@x18n/lsp` 0.1.5 or newer.

## Install the language server

Pick one:

1. **Workspace package** (recommended, matches VS Code `x18n.useLocalServer`):

   ```sh
   npm install -D @x18n/lsp
   ```

2. **Extension download** of `@x18n/lsp` into the extension work directory on first start (needs the npm install capability).

3. **npx**: `"useNpx": true` under `lsp.x18n.settings` (`npx -y @x18n/lsp@<serverVersion> --stdio`).

## Zed settings (project `.zed/settings.json`)

```json
{
  "lsp": {
    "x18n": {
      "settings": {
        "useLocalServer": true,
        "displayLocale": "",
        "annotationMaxLength": 40,
        "codeLens": false,
        "showFlags": true
      }
    }
  },
  "inlay_hints": {
    "enabled": true,
    "show_other_hints": true
  }
}
```

Restart the language server after changing settings (**Restart Language Server** for the worktree). There is no `x18n: Restart Language Server` command in Zed.

## Checks

- [ ] Open a file with `t('some.key')` and check **diagnostics** for missing or invalid keys (same checks as `x18n check`).
- [ ] **Hover** on a key shows locale messages and a usage count.
- [ ] **Go to definition** on a key opens the locale entry.
- [ ] **Find all references** lists usages in code.
- [ ] **Rename** (F2) updates usages and locale resources.
- [ ] **Completion** inside `t('…` suggests keys.
- [ ] **Code action** on a hard string offers extract / ignore when the server provides it.
- [ ] **Inlay hints** show annotation text when enabled (not VS Code in-place annotations).

## Troubleshooting

- Open **Zed.log** (`zed: open log`) if the server fails to start.
- Confirm the spawned command uses **`--stdio`** (this extension adds it for `node` and `npx`).
- If no resources are found, run `x18n doctor` in the project. The server logs similar guidance.
