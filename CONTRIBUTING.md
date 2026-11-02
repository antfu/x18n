# Contributing to x18n

Thanks for helping out. General etiquette follows https://github.com/antfu/contribute. This page covers what is specific to this repo. The architecture and rules live in [`AGENTS.md`](./AGENTS.md) and [`plans/`](./plans/README.md); where code and plan disagree, the code and its tests win.

## Setup

You need Node >= 22 and the pnpm version in `packageManager` (use Corepack).

```sh
pnpm install   # also runs codegen and sets up git hooks
pnpm build
```

Dependencies go through the pnpm catalogs (`catalog:<name>`). Do not pin versions in a `package.json`.

## Working on each part

| Part | How |
| --- | --- |
| Any package | `pnpm dev` rebuilds packages on change |
| Tests | `pnpm test` builds first, then runs Vitest |
| Docs | `pnpm docs` |
| VS Code extension | Open the repo in VS Code and press F5 (see below) |
| Zed extension | See [`packages/zed/README.md`](./packages/zed/README.md) for the dev extension and package checks |

### Debugging the VS Code extension

`.vscode/launch.json` has a **Run x18n Extension** configuration. Press F5 and it:

1. Runs the `x18n: dev` task (`tsdown --watch --sourcemap` in `packages/vscode`) and waits for the first build.
2. Opens an Extension Development Host with the extension loaded and this repo as its workspace. The root `x18n.config.ts` activates the extension.

After you edit code, reload the host window (Cmd/Ctrl+R). The watcher has already rebuilt `dist`. Breakpoints in `src/` work through sourcemaps. The e2e suite runs with `pnpm -C packages/vscode test:e2e`.

The extension is bundled to CJS, so `import.meta` is empty at runtime. Code in `@x18n/node` and the packages below it MUST NOT rely on `import.meta` at module load without a fallback.

### Working on the Zed extension

The Zed registry builds the WASM module from `packages/zed`. Do not commit `extension.wasm`. This package uses Rust and Node's test runner. From `packages/zed`, run `pnpm test`, `cargo test`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo build --release --target wasm32-wasip2`. See its [README](./packages/zed/README.md) for local installation and editor checks.

## Rules to keep in mind

- Names follow [`plans/glossary.md`](./plans/glossary.md): resource, message, usage, plugin, preset.
- Layer boundaries are enforced: `@x18n/core` and `@x18n/builtins` MUST NOT import `node:*`, and surfaces reach project state only through the core `Project` API. See [`plans/01-architecture.md`](./plans/01-architecture.md).
- CLI `--json` output, LSP `x18n/*` requests, RPC functions and MCP tools are wire contracts. Changing them needs schema or snapshot test updates.
- `test/exports.test.ts` snapshots the public API of every published package. Run `pnpm test -u` only for intended API changes.

## Before you open a PR

All gates MUST pass:

```sh
pnpm lint && pnpm knip && pnpm test && pnpm typecheck && pnpm build
```

CI also runs `x18n check --strict` (the repo checks its own messages) and a docs check, so run `pnpm ci` to match it. The pre-commit hook only checks the lockfile and lints the staged files.

Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/), for example `fix(node): load configs when bundled to CJS`. Keep a PR to one change, and describe what you ran to verify it.
