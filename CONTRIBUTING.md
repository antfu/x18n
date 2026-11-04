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

### Docs translations

The docs are written in English, in `docs/content`. [diglot](https://github.com/danielroe/diglot) translates them segment by segment (headings, paragraphs, list items, table cells): `docs/i18n` holds its config, glossary and style rules, and one record per locale and segment in `docs/i18n/<locale>/segments`. `pnpm -C docs run generate` applies the records to the English pages and writes `docs/content/<slug>` for each locale (for example `docs/content/pt-br`, served at `/pt-br`). The locales are zh-Hans, zh-Hant, ja, ko, ru, fr, de, it, pt-BR and es. Do not edit those pages. A segment without a record keeps its English text.

A new or changed English segment shows in English on the translated pages until it has a record. To fix a translation, change the `text` of its record, set `review` to `edited` and `origin` to `human`, and run `pnpm -C docs run generate`. `pnpm -C docs run i18n:status` shows the coverage of each locale, and `pnpm -C docs run i18n:validate` checks every record.

`docs/x18n.config.ts` loads diglot's [x18n plugin](https://github.com/danielroe/diglot/tree/main/packages/x18n), so the docs dogfood x18n: each segment hash is a key, and each place a segment occurs in the English pages is a usage. `pnpm -C docs run i18n:ui` exports those pages to `docs/i18n/.diglot/sources` (git-ignored) and opens the x18n UI. There you can review, edit and approve translations; an edit through x18n rewrites the record as a human edit. Other x18n commands work from `docs`, or with `--root docs` from the repo root, for example `x18n check --root docs`. The root `x18n.config.ts` does not include this project, so `x18n check --strict` checks the UI's messages only.

To add a locale, add it to `locales` in `docs/i18n/diglot.config.ts`; add `docs/i18n/<locale>/locale.yml`, `style.yml` and `glossary.yml`, and its terms to `docs/i18n/glossary.yml`; and add its slug (the locale in lowercase) to `docs/app/utils/locales.ts`, to the `path` of `docs/app/pages/[locale].vue` and to the ignored `docs/content` directories in `eslint.config.js`.

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
