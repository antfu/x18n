# 01 - Architecture

## Packages

| Directory | npm name | Runtime | Role |
| --- | --- | --- | --- |
| `packages/core` | `@x18n/core` | any JS runtime | Domain model, project engine, plugin runner, config schema, edit planner, checks, prompt builder. No I/O. |
| `packages/builtins` | `@x18n/builtins` | any (some subpaths load WASM) | Built-in plugins and presets: formats, locale finders, scanners, extractors, checks, reporters. |
| `packages/node` | `@x18n/node` | Node >= 22 | Node host (file system, glob, watch, cache, git identity), config and plugin loading. |
| `packages/cli` | `@x18n/cli` | Node >= 22 | The `x18n` command. Ships the agent skill. |
| `packages/lsp` | `@x18n/lsp` | Node >= 22 | Language server (`x18n-lsp --stdio`). Hosts the UI server on request. |
| `packages/ui` | `@x18n/ui` | Node side + browser SPA | devframe definition (node side) and the Nuxt SPA (browser side). |
| `packages/devtools` | `@x18n/devtools` | Node >= 22 | The UI as a devtools panel: a Vite plugin for Vite DevTools and Nuxt DevTools (`/vite`) and a devframe definition for hubs (`/devframe`). |
| `packages/vscode` | `x18n-vscode` (private, Marketplace + Open VSX) | VS Code extension host | Extension client. Bundles the LSP and UI assets. |
| `packages/zed` | `x18n-zed` (private, Zed registry) | Zed WASM extension host | Extension client. Starts `@x18n/lsp` through Node. |
| `docs` | private | - | Docs site on the comark-docs Nuxt layer, also hosts the in-browser playground. |

## Dependency graph

```
                @x18n/core
               /    |     \
   @x18n/builtins   |      \
          \         |       \
           @x18n/node        \
           /      |   \       \
     x18n (cli)   |   @x18n/ui (node side) ----+
           \      |   /                        |
            @x18n/lsp                          |
                |                              |
           x18n-vscode  (bundles lsp + ui SPA) |
                                               |
   @x18n/ui (SPA) --- browser backend: core + builtins + browser host
```

- `x18n` (CLI) depends on `@x18n/ui` for `x18n ui`, `x18n build` and `x18n mcp`.
- `@x18n/devtools` depends on `@x18n/ui` and `@x18n/node`; it loads the workspace from the host's root when the host sets the devframe up.
- `@x18n/lsp` depends on `@x18n/ui` to start the UI server from the same project instance.
- `x18n-vscode` depends on `@x18n/lsp` only, plus the UI assets for the webview.

## Layer rules

These are invariants. They SHOULD be enforced with lint rules (`no-restricted-imports` per package) once the packages have code.

1. `@x18n/core` MUST NOT import `node:*`, `vscode`, `vscode-languageserver*`, `devframe`, or any parser of a concrete format. It MAY depend on small runtime-neutral libraries (`valibot`, `pathe`, `picomatch`-like matchers).
2. `@x18n/core` MUST NOT know any i18n library or file format by name. Names like `vue-i18n` or `yaml` appear only in `@x18n/builtins`.
3. `@x18n/builtins` MUST use only the public API of `@x18n/core`. A built-in plugin is written exactly as a third-party plugin would be. If a built-in needs something the API lacks, the API grows.
4. `@x18n/builtins` MUST NOT import `node:*`. Plugins that need heavy parsers load them lazily, and MUST offer a browser-safe path (WASM or pure JS) or declare that they are Node-only through `plugin.runtime` ([03-plugins.md](./03-plugins.md)).
5. Interaction (prompts, pickers, confirmations) MUST NOT happen in core. Core returns a choice to the caller as data (for example `EditPlan` with `needsDecision`), and the surface asks the user.
6. Surfaces (CLI, LSP, UI, extension) MUST reach project state only through the `Project` API of core. No surface reads locale files itself.
7. One process holds at most one `Project` per root. The LSP and its UI server share it, so an edit in the UI shows up in the editor without a reload.
8. Any output that tools or agents read (CLI `--json`, LSP custom requests, RPC functions, MCP tools) is a **wire contract**. It MUST be versioned and covered by schema or snapshot tests ([06-cli.md](./06-cli.md)).

## Runtime flow

```
host (fs/glob/watch)                                   surfaces
       |                                                  ^
       v                                                  |
 config resolve -> plugin runner -> resource discovery -> indexes -> analysis -> queries / events
                                     (finders, formats)  (keys,    (checks)
                                                          usages)
                                                              ^
                                       edit planner <---------+---- edits (set, rename, delete, extract)
                                           |
                                           v
                                   FileChange[] -> host applies (or LSP returns WorkspaceEdit)
```

## Process topologies

| Surface | Processes |
| --- | --- |
| CLI one-shot (`x18n check`) | One Node process: node host, project, exit. |
| CLI UI (`x18n ui`) | One Node process: project + devframe dev server, browser connects over WebSocket. |
| DevTools panel | The app's Vite dev server: the host (Vite DevTools, Nuxt DevTools, a devframe hub) mounts the devframe, owns auth and the WebSocket, and serves the SPA at `/__x18n/`. |
| Static report (`x18n build`) | Build step dumps RPC results. The deployed site has no server. |
| In-browser workspace (1.x) | No server. The SPA runs core + builtins with a browser host over the File System Access API or in-memory demo files. |
| Other LSP editors (1.x) | Editor spawns `x18n-lsp`. The server holds the project and an overlay host for unsaved buffers. |
| VS Code | Extension starts the bundled LSP. On "Open x18n", the LSP starts the devframe server on loopback with a pre-issued auth token; a webview iframes it through `asExternalUri`. The extension client also handles coexistence with TypeScript's providers ([08-vscode.md](./08-vscode.md)). |

## Repository tooling

- pnpm workspaces with named catalogs. Versions MUST NOT be pinned in a `package.json`.
- Turborepo runs `build`, `typecheck` and `test` across packages.
- tsdown builds libraries (ESM, `.d.mts`). The extension builds to CJS with `vscode` external.
- Nuxt builds the SPA (`ssr: false`, static output, relative base).
- Vitest projects per package. tsnapi snapshots the public API of each published package.
- ESLint through `@antfu/eslint-config` with antislop, knip for unused code.
- Node >= 22, ESM only. VS Code engine `^1.100.0`.
