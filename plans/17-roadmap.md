# 17 - Roadmap

Each milestone is one or a few PRs. A milestone is done when its exit criteria pass in CI. Milestones up to M11 make 1.0. Everything after is 1.x.

## M0 - Plan and scaffold (this PR)

- `plans/` documents.
- pnpm monorepo with catalogs, Turborepo, `tsconfig.base.json`, ESLint, knip, Vitest projects, tsnapi.
- Each package gets a minimal real seed:
  - `@x18n/core`: plugin, preset and config types, `definePlugin`, `definePreset`, `defineConfig`, memory host
  - `@x18n/builtins`: `json` format
  - `@x18n/node`: node host that reads and writes files
  - `x18n`: CLI with `--version`
  - `@x18n/lsp`: server that answers `initialize`
  - `@x18n/ui`: devframe definition and a Nuxt SPA shell
  - `x18n-vscode`: activates, starts the LSP, and has staged packaging as `antfu.x18n`
  - `docs`: comark-docs layer and a landing page
- Root `x18n.config.ts` for the UI's own messages (dogfooding).

**Exit:** all five gates pass.

## M1 - Core engine, read path

- Domain types, `KeyString` codec, locale codes as found, plus the `localeInfo` display parse.
- Config schema (valibot), resolution with origins, `projects` with inheritance, JSON Schema generation at build.
- Plugin runner: order, presets, `config` hooks, conflicts, `explain()`.
- `pattern` finder (port of PathMatcher). Formats `json`, `jsonc`, `json5`, `yaml` (read).
- Key index, `project.keys()`, `get`, `message`, coverage.
- Checks runner, `recommended` and `strict` sets, and the checks `missing-translation`, `empty-translation`, `key-conflict`, `locale-code-conflict`.

**Exit:**
- memory-host tests on 3 fixtures
- config schema snapshot
- type tests for `defineConfig`, `definePlugin`, `definePreset`

## M2 - Node host, config loading, CLI read commands and `x18n check`

- Node host: glob with gitignore, watch, persistent cache.
- Config loading for `x18n.config.ts` (primary) and for YAML and JSON. YAML plugin loading.
- Manifest readers and preset detection. Tier 1 presets get resources and key hooks.
- CLI commands:
  - bare `x18n` (status)
  - `status`, `keys`, `get`, `locales`, `doctor`, `schema`, `init` (writes `x18n.config.ts`)
- **`x18n check`**, behaving like `tsc`:
  - path and position, a severity badge line, a code frame, and an "N errors, N warnings, N files" summary
  - `--watch`, `--strict`, `--locale`, `--max-warnings`
- Reporters: `pretty`, `json`, `markdown`, `github`.
- JSON contract v1 for these commands.

**Exit:**
- CLI snapshot tests on fixtures
- this repo's CI runs `x18n check` with the root `x18n.config.ts`

## M3 - Usage scanning and analysis

- `regex` scanner (port).
- `js` scanner on oxc. It matches by name and covers:
  - aliases, declared wrappers, params with configured type annotations
  - same-file constants, `@x18n-key` markers
  - the i18next selector form
- `vue` and `svelte` scanners.
- Scopes and namespaces from factories, dynamic prefix usages, derived keys, opt-outs.
- Usage index with per-file hashes and persistent cache.
- Checks `missing-key` and `unused-key`. CLI `usages` and `keys --unused`.
- Benchmark fixture; budgets tracked from here.

**Exit:** parity tests against i18n-ally examples for the tier 1 presets (same keys found).

## M4 - Edits and write commands

- Edit planner, decisions, stale-plan detection.
- In-place `edit` for json, jsonc and yaml. `serialize` fallback, key-style handling, `keepFilled`.
- New-key placement: namespace, then longest prefix, then first resource; ask only on a tie.
- Rename:
  - whole key, and subtree (renaming a parent)
  - across namespaces (moves entries, creates files)
  - re-nesting with cleanup of empty parents
  - refuses on conflict
  - rewrites the static part of dynamic usages
- Placeholder syntaxes per preset. Checks `placeholder-mismatch` and `invalid-syntax`.
- CLI `set`, `apply`, `rename`, `delete`, `fill`, `format`, all with `--dry-run`.

**Exit:**
- round-trip tests prove bytes outside the edited ranges stay the same
- rename updates code in all tier 1 presets
- subtree and cross-namespace rename fixtures pass

## M5 - Language server and minimal VS Code client

- Overlay host and one project per folder.
- Full workspace index at startup with `$/progress`. References and rename wait for it.
- Definition goes to the source-locale entry. Implementation lists every locale's entry. References work from code and from resources.
- Rename from usages and from resource keys: whole key in code and for flat keys, subtree on parent nodes.
- Diagnostics identical to `x18n check`. Hover, inlay hints, completion, code actions, symbols.
- Custom `x18n/*` protocol.
- VS Code client: starts the server, handles TypeScript coexistence (provider order, TS 7 middleware, deduplicated references), and in-place annotations.

**Exit:**
- in-process LSP tests for each feature
- a VS Code e2e test proves that rename on a typed key literal reaches x18n, with TS 6 tsserver active

## M6 - Agent surface

- Translate and review prompt builders, the `translatePrompt` hook, glossary.
- CLI `prompt translate`, `prompt review`, paging with cursors.
- devframe definition in the `@x18n/ui` node side, and `x18n mcp`.
- Skills `x18n`, `x18n-setup` and `x18n-check` in the root `skills/` directory, shipped in `@x18n/cli`, with a test that every command in the skills exists.

**Exit:** a scripted agent loop on a fixture (prompt, apply generated JSON, check) ends with zero missing translations.

## M7 - UI

- Nuxt SPA with its own UnoCSS tokens, and a `UiBackend` with `server` and `static` adapters.
- Pages: overview, keys grid, key detail, locale, usages, extraction (wired in M9), project.
- `x18n ui` with auth always on: one-click magic link, bearer token for HTTP MCP, `--no-auth` for CI only. `x18n build`.
- The LSP hosts the UI server through `x18n/openUi`.
- UI messages localized with x18n.

**Exit:** Playwright e2e for dev (edit a value, the file changes on disk; an unauthenticated request is refused) and for static (renders, no edit controls).

## M8 - VS Code extension complete

- Sidebar views: Current File, Progress, Keys, Usage Report. Status bar locale switcher.
- UI panel (webview iframe), commands, schema validation contributions.
- Packaging through a staged copy named `x18n`, for the id `antfu.x18n`, on the Marketplace and Open VSX. Publishing waits for human approval.

**Exit:** test-electron smoke test; manual checklist in the PR.

## M9 - Extraction

- Extractors and rules (port), bare-slug key generation, templates per preset, plan files.
- CLI `extract`, LSP code actions, UI `/extract`, MCP tools.

**Exit:** extraction fixtures per tier 1 preset produce the expected source and resource edits.

## M10 - i18n-ally migration

- `x18n migrate i18n-ally` and the VS Code prompt.

**Exit:** migration fixtures; a migrated config finds the same keys and usages as i18n-ally on its examples, for tier 1 presets.

## M11 - Performance (1.0 gate)

- Cache tuning, LSP memory work. Worker-thread scanning in the node host was built and measured, and did not pay off ([D30](./decisions.md#d30---no-worker-threads-in-10)).

**Exit:** the budgets in [15-quality.md](./15-quality.md) pass on the benchmark fixture; CI fails on a regression over 20%.

## Follow-ups found while building 1.0

These did not block the 1.0 exit criteria and move to 1.x:

- MCP prompts `translate`, `review`, `extract` once devframe supports prompts (D31).
- UI: choose and reorder locale columns, bulk actions, shiki highlighting of snippets.
- Parity tests against the upstream i18n-ally example projects (the fixtures under `test/fixtures/` cover each tier 1 preset).
- The TS 7 `registerLspMiddleware` path in the extension is guarded but untested until the API ships.
- Faster cold start: load `yaml`, `@vue/compiler-sfc` and other heavy modules only when a run needs them. A cold `x18n check` spends about as long loading modules as scanning (D30).

## 1.0 release

Packages and the extension share one version (`bumpp -r`). Every release needs explicit human approval.

## 1.x

| Milestone | Content |
| --- | --- |
| M12 Reviews | YAML review store, CLI `review *`, LSP, VS Code comments and Reviews view, UI threads, review records as a history provider ([12-reviews.md](./12-reviews.md)) |
| M13 Typegen | `x18n typegen`, preset augmentations, typed params, LSP regeneration, `typegen-stale` check ([18-typegen.md](./18-typegen.md)) |
| M14 In-browser workspace | Browser host, worker, WASM scanners, `local` backend, docs `/play` and `/demo` |
| M15 Tier 2 and 3 | Presets and formats from [05-builtins.md](./05-builtins.md) that i18n-ally never had (paraglide, typesafe-i18n, ARB, XLIFF, Android XML, Apple strings, resx), accessor scanners (`m.*`, `LL.*`). Every i18n-ally framework already ships (D34). |
| M16 Other editors | Tested setups and docs for Neovim, Zed, Helix |
| M17 History | History provider capability, git provider, `stale-translation`, `prompt translate --stale`, LSP hover dates, UI ([19-history.md](./19-history.md)). |
| M18 DevTools | `@x18n/devtools`: the UI as a panel in Vite DevTools, Nuxt DevTools and devframe hubs ([09-ui.md](./09-ui.md#devtools-panel)). |
| M19 Machine translation | Translator capability and pipeline, `@x18n/translator-ai`, `deepl`, `google`, message checks, provenance, batch approval in the CLI, UI and VS Code, CLI `translate`, LSP, VS Code client translator, UI panel, MCP tool ([20-translation.md](./20-translation.md)). |
