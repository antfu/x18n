# 06 - CLI

Package `x18n`, binary `x18n`, built with `cac`. The CLI is a thin layer: it builds a node host, resolves config, creates a project, calls the core API and formats the result.

## Global flags

| Flag | Meaning |
| --- | --- |
| `--root <dir>` | Project root (default: cwd, or nearest config upward). |
| `--config <file>` | Explicit config file. |
| `--project <name>` | Pick one project in a monorepo config. Default: all. |
| `--json` | Print the JSON contract instead of human output. Implies no color and no prompts. |
| `--no-cache` | Ignore the persistent cache. |
| `--yes` | Accept default answers for decisions. Without a TTY and without `--yes`, a command that needs a decision fails with `X18N4003` and lists the decisions. |

## Commands

### Look

Bare `x18n` prints `x18n status` followed by the main commands. It never starts a server.

| Command | Does |
| --- | --- |
| `x18n status` | Locales with coverage, resource count, key count, diagnostics summary. |
| `x18n keys [glob]` | List keys. `--missing <locale>`, `--unused`, `--namespace`, `--values` (include values per locale). |
| `x18n search <query>` | Keys by value in any locale, fuzzy, best first, with usages. `--exact` for substring matches only. |
| `x18n get <key>` | All values, resources, usages and reviews of one key. |
| `x18n usages [key]` | Usages of a key, or all usages. `--file <path>` limits to a file. |
| `x18n locales` | Locale codes as found, with display names, flags and resources. |
| `x18n doctor` | `project.explain()`: detected presets, finders, formats, scanners, config origins. |

### Check

`x18n check` is to i18n what `tsc --noEmit` is to types. It reports invalid, untranslated and unused keys (the check table in [05-builtins.md](./05-builtins.md)). The editor shows exactly the same diagnostics.

```
src/pages/Home.vue:12:15 - error missing-key: "home.titel" is not defined in en.
12   <h1>{{ $t('home.titel') }}</h1>
                 ~~~~~~~~~~
locales/en.json:4:5 - warning missing-translation: "home.subtitle" is missing in de, fr.

Found 1 error and 1 warning in 2 files.
```

| Flag | Meaning |
| --- | --- |
| `--watch` | Re-check on change and clear the screen, like `tsc --watch`. |
| `--strict` | Turn every warning into an error (same as config `strict: true`). |
| `--locale <l>` | Only report for these locales (repeatable). |
| `--only <checkIds>` / `--skip <checkIds>` | Narrow the checks. |
| `--max-warnings <n>` | Fail when there are more than `n` warnings. |
| `--reporter <id>` | `pretty` (default), `json`, `markdown`, `github`, `sarif`. Repeatable, with `--output <file>`. |
| `--update-baseline` | Write the reported diagnostics into the baseline. Entries that `--only`, `--skip` or `--locale` leave out stay. |
| `--baseline <file>` | Baseline file (default `.x18n/check-baseline.json` in the workspace root). |

While the baseline file exists, `check` reports and fails only on diagnostics it does not hold, and says how many it left out and how many of its entries no longer occur (`data.baseline` in `--json`). An entry is a path relative to the workspace root, a check id, a key, a locale and a message, with a count; no line, so moving code keeps it known, while one more identical diagnostic in the same file is new. The file is sorted for small diffs. The editor still shows every diagnostic. The idea comes from [i18next-cli](https://github.com/i18next/i18next-cli) `lint --update-baseline` and ESLint bulk suppressions.

`x18n check` is read-only and has no `--fix`. Fixes go through explicit commands (`x18n delete`, `x18n fill`, `x18n rename`, ...) or through editor code actions.

### Change

All write commands support `--dry-run`, which prints the plan (files and edits) instead of writing.

| Command | Does |
| --- | --- |
| `x18n set <key> --locale <l> --value <v>` | Set one value. `--value -` reads stdin. |
| `x18n apply <file \| ->` | Batch set from JSON: `{ "<locale>": { "<key>": "<value>" } }`. The same shape the translate prompt asks for. Validates placeholders before writing; `--force` writes anyway. |
| `x18n rename <from> <to>` | Rename a key in all locales, usages and review threads. When `<from>` is a parent node (`x18n rename pages screens`), every key under it moves, and the static part of dynamic usages is rewritten. A namespace change (`common:save actions:save`) moves entries between files. Refuses when the target exists. `--no-usages` keeps code. |
| `x18n delete <key>` | Delete in all locales. `--locale` limits. |
| `x18n fill [--locale]` | Add missing keys with empty values (or source values with `--copy-source`). |
| `x18n format` | Re-write resources with configured sort and indent. |
| `x18n extract [files...]` | Hard-string extraction ([11-extraction.md](./11-extraction.md)). `--list` prints candidates, `--plan <file>` applies an edited plan. |

### Agents and prompts

| Command | Does |
| --- | --- |
| `x18n prompt translate --to <locale>` | Prints a translation prompt ([10-agents.md](./10-agents.md)). `--keys <glob>`, `--limit <n>`, `--format markdown\|json`, `--stale` (add stale translations, [19-history.md](./19-history.md)), `--check [ids]` (add values that checks report in the target locale, all checks or these ids; each item lists the reports as `issues`). Copies of the source are never style examples. |
| `x18n prompt review --locale <l>` | Prompt to review existing translations against source and glossary. |
| `x18n mcp` | MCP server over stdio ([10-agents.md](./10-agents.md)). |

### Reviews

`x18n review list [key] | comment <key> | approve <key> | request-change <key> --text | suggest <key> --value | resolve <id> | apply-suggestion <id> | mark-fresh <key>`, with `--locale`, `--text`, `--author`, `--open` and `--dry-run`. See [12-reviews.md](./12-reviews.md).

### Typegen (1.x)

`x18n typegen [--watch]` writes `x18n.d.ts` ([18-typegen.md](./18-typegen.md)).

### UI

| Command | Does |
| --- | --- |
| `x18n ui` | Start the devframe dev server and open the browser with a one-click auth link ([09-ui.md](./09-ui.md)). Prints the OTP code and the MCP bearer token. `--port`, `--host`, `--no-open`, `--no-auth` (CI and e2e only, prints a warning). |
| `x18n build` | Static snapshot report. `--out-dir`, `--base`. |

### Setup

| Command | Does |
| --- | --- |
| `x18n init` | Detect and write `x18n.config.ts` (`--format yml` or `json` for non-JS projects). |
| `x18n migrate i18n-ally` | Convert i18n-ally settings ([13-migration.md](./13-migration.md)). |
| `x18n plugin eject <file.yml>` | Print the TS equivalent of a YAML plugin. |
| `x18n schema [config\|plugin]` | Print a JSON Schema. |

## JSON contract

Every `--json` output has this envelope:

```json
{
  "x18n": 1,
  "command": "keys",
  "data": {},
  "diagnostics": [],
  "errors": []
}
```

- `x18n` is the contract version. A breaking change to any `data` shape bumps it. Adding optional fields does not.
- `data` shapes are valibot schemas in `@x18n/core` (`contracts/`), and the docs publish them as JSON Schema.
- Errors carry `name` (the code), `why`, `fix` and `docs`, the JSON of a [nostics](https://nostics.dev) diagnostic. They are also printed, but in JSON mode only inside the envelope, so stdout is always one JSON document.
- Snapshot tests cover the output of every command on fixture projects.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. For `check`: no errors, and warnings within `--max-warnings`. |
| 1 | `check` found errors (or too many warnings). `apply` rejected values. |
| 2 | Usage or config error. |
| 3 | A decision is needed and no answer was given. |
| 4 | Plan is stale (files changed during the command). |

## Output rules

- Human output goes to stdout; progress and logs go to stderr, so `x18n keys > keys.txt` works.
- No spinners or colors without a TTY. `NO_COLOR` and `FORCE_COLOR` are honoured.
- Paths are printed relative to the cwd.
