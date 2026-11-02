# x18n maintainer guide

x18n views and maintains the i18n files of any project, for humans and agents: an editor-neutral core, a CLI, a language server, a VS Code extension, and a devframe UI. The plan lives in [`plans/`](./plans/README.md). Where code and plan disagree, the code and its tests win, and the plan gets fixed.

## Rules that apply everywhere

- **MUST**, **MUST NOT**, **SHOULD** and **MAY** use RFC 2119 meanings. They mark
  real invariants - layer boundaries, wire contracts, output shapes - not house style.
- Before a PR, all gates MUST pass:
  `pnpm lint && pnpm knip && pnpm test && pnpm typecheck && pnpm build`.
  Commits follow Conventional Commits.
- Names MUST follow [`plans/glossary.md`](./plans/glossary.md) (resource, message, usage, plugin, preset, ...).
- Dependencies go through the pnpm catalogs (`catalog:<name>`); versions MUST NOT be pinned in a `package.json`.

## Boundary invariants

Full list and reasons: [`plans/01-architecture.md`](./plans/01-architecture.md).

- `@x18n/core` MUST NOT import `node:*`, `vscode`, LSP or devframe packages, and MUST NOT name any i18n library or file format.
- `@x18n/builtins` MUST use only the public API of `@x18n/core` and MUST NOT import `node:*`.
- Core MUST NOT prompt or ask; it returns decisions as data and surfaces ask.
- Surfaces (CLI, LSP, UI, extension) reach project state only through the core `Project` API.
- CLI `--json` output, LSP `x18n/*` requests, RPC functions and MCP tools are wire contracts: versioned and covered by schema or snapshot tests.

## Built-ins load on demand

`@x18n/builtins` keeps what decides from what does the work, so a run loads only the modules it needs.

- Presets: each preset is a folder, `src/presets/<name>/`. `entry.ts` is cheap and always loaded: it default-exports
  `{ detect, exclusive?, load: () => import('./index') }`. `index.ts` is the preset, with its helpers beside it, and core
  calls `load` only when `detect` passes or the config lists the preset. A preset module MUST NOT carry `detect` or
  `exclusive`; `entry.ts` MUST NOT statically import the implementation. `src/presets/index.ts` only maps names to
  entries. Code shared by several presets goes in `src/presets/shared/`.
- Formats and scanners follow the same pattern: a folder per format or scanner, `src/formats/<name>/` and
  `src/scanners/<name>/`, with `entry.ts` (`{ extensions, load: () => import('./index') }`, always loaded) and `index.ts`
  (the implementation). Core loads a format when it first reads a file of that extension (`registry.loadFormatFor`) and a
  scanner when it first scans a matching file (`registry.loadScannersFor`); `formatFor` returns only loaded formats.
  `entry.ts` and the module MUST agree on id and extensions (`test/entries.test.ts` checks it).
- `regex` is the exception among scanners: its extensions come from `usage.regex`, so `createBuiltins()` always loads it.
  Reporters are a map of loaders, also loaded by `createBuiltins()`.
- Each module is its own tsdown entry (`@x18n/builtins/<kind>/<name>`, from `<name>/index.ts`) and exports its factory by name and as `default`.
  The `index.ts` of a kind holds only the map. Code shared between modules goes in a `shared/` folder, which is never an entry.
- `src/index.ts` imports the maps through the package name (`@x18n/builtins/presets`) and `tsdown.config.ts` keeps
  them external. Without that, the map and the entry share a chunk with mangled export names, and the tsnapi snapshot
  turns unreadable and changes every build.

## Layout

| Path | Package |
| --- | --- |
| `packages/core` | `@x18n/core` |
| `packages/builtins` | `@x18n/builtins` |
| `packages/node` | `@x18n/node` |
| `packages/cli` | `@x18n/cli` |
| `packages/lsp` | `@x18n/lsp` |
| `packages/ui` | `@x18n/ui` (Nuxt SPA in `app/`, devframe node side in `src/node/`) |
| `packages/devtools` | `@x18n/devtools` (the UI in Vite DevTools, Nuxt DevTools and devframe hubs) |
| `packages/vscode` | `x18n-vscode` (private, published to the Marketplace) |
| `packages/zed` | Zed Rust/WASM extension (Zed registry path: `packages/zed`) |
| `docs` | docs site on the comark-docs layer (`x18n.dev`) |

The root `x18n.config.ts` points x18n at the UI's own messages (`packages/ui/app/locales`), so the repo checks itself.

## Commands

- `pnpm codegen` writes files that typecheck needs (`.nuxt` types, `packages/vscode/src/generated/meta.ts`). It runs on install.
- `pnpm test` builds first; `test/exports.test.ts` snapshots the public API of every published package with tsnapi. Update snapshots with `pnpm test -u` only for intended API changes.
- `pnpm docs` starts the docs site.
