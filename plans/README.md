# x18n plans

x18n is a tool for viewing and maintaining the i18n files of any project, by humans and by agents. Its language server follows the LSP standard, and VS Code is the supported editor for 1.0. It takes the ideas of [i18n-ally](https://github.com/lokalise/i18n-ally) and rebuilds them as layers:

```
@x18n/core  ->  x18n (CLI)  ->  @x18n/lsp  ->  x18n-vscode
     \______________ @x18n/ui (devframe) ______________/
```

These documents are the plan. Each document owns one area. Where code and plan disagree after implementation, the code and its tests win, and the plan gets fixed or the finished section gets removed.

## Reading order

| # | Document | Owns |
| --- | --- | --- |
| 00 | [Vision](./00-vision.md) | Goals, non-goals, users, success criteria |
| 01 | [Architecture](./01-architecture.md) | Packages, layer rules, dependency graph |
| 02 | [Core](./02-core.md) | Domain model, host interface, project engine, edits |
| 03 | [Plugins](./03-plugins.md) | Plugin and preset API, hooks, YAML plugins |
| 04 | [Config](./04-config.md) | Config files, schema, resolution, JSON Schema |
| 05 | [Built-ins](./05-builtins.md) | Built-in formats, finders, scanners, presets, checks, reporters |
| 06 | [CLI](./06-cli.md) | Commands, flags, JSON output contract, exit codes |
| 07 | [LSP](./07-lsp.md) | Language server features and custom protocol |
| 08 | [VS Code](./08-vscode.md) | Extension features on top of the LSP |
| 09 | [UI](./09-ui.md) | devframe app: dev server, static build, in-browser, VS Code embed |
| 10 | [Agents](./10-agents.md) | Agent workflows, translate prompts, MCP, shipped skill |
| 11 | [Extraction](./11-extraction.md) | Hard-string detection and extraction |
| 12 | [Reviews](./12-reviews.md) | Review comments and suggestions |
| 13 | [Migration](./13-migration.md) | Moving from i18n-ally |
| 14 | [Vendoring](./14-vendoring.md) | What we take from i18n-ally and how |
| 15 | [Quality](./15-quality.md) | Typing rules, tests, fixtures, performance budgets |
| 16 | [Docs site](./16-docs.md) | comark-docs site and hosted playground |
| 17 | [Roadmap](./17-roadmap.md) | Milestones, order, exit criteria |
| 18 | [Typegen](./18-typegen.md) | Generated TS key types (1.x) |
| 19 | [History](./19-history.md) | History providers, git history, stale translations |
| -- | [Decisions](./decisions.md) | Decision log with reasons |
| -- | [Glossary](./glossary.md) | Canonical names |

## Status

| Milestone | Title | Release | Status |
| --- | --- | --- | --- |
| M0 | Plan and monorepo scaffold | 1.0 | DONE |
| M1 | Core engine (read path) | 1.0 | DONE |
| M2 | Node host, config loading, CLI read commands, `x18n check` | 1.0 | DONE |
| M3 | Usage scanning and analysis | 1.0 | DONE |
| M4 | Edits and write commands | 1.0 | DONE |
| M5 | Language server and minimal VS Code client | 1.0 | DONE |
| M6 | Agent surface (prompts, MCP, skill) | 1.0 | DONE |
| M7 | UI: dev server, static build, VS Code panel | 1.0 | DONE |
| M8 | VS Code extension complete | 1.0 | DONE |
| M9 | Extraction | 1.0 | DONE |
| M10 | i18n-ally migration | 1.0 | DONE |
| M11 | Performance (1.0 gate) | 1.0 | DONE |
| M12 | Reviews | 1.x | DONE |
| M13 | Typegen | 1.x | i18next done, other presets TODO |
| M14 | In-browser workspace and docs playground | 1.x | TODO |
| M15 | Tier 2 and 3 presets and formats | 1.x | TODO |
| M16 | Other editors (Neovim, Zed, Helix) | 1.x | TODO |
| M17 | History providers and stale translations | 1.x | DONE |

Status values: TODO, IN PROGRESS, DONE, BLOCKED (with reason). The full breakdown is in [17-roadmap.md](./17-roadmap.md).
