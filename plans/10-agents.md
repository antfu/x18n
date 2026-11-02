# 10 - Agents

Agents are first-class users. They get three things: a CLI with stable JSON, prompts that describe work, and an MCP server. Skills shipped in the `@x18n/cli` package teach the workflow.

## Principles

- An agent never has to parse human output: every command has `--json` ([06-cli.md](./06-cli.md)).
- An agent never has to edit locale files by hand. `x18n set` and `x18n apply` keep formatting, key style and file choice correct, and validate placeholders.
- Every write can be a dry run first (`--dry-run`), and every write is followed by a check the agent can run (`x18n check --only placeholder-mismatch,invalid-syntax --json`).
- Output size is bounded: list commands take `--limit` and return `nextCursor`, so a large project does not flood the context.

## Translate prompt

x18n does not call translation services. Instead it writes a prompt that a human pastes into an LLM, or that an agent follows.

`x18n prompt translate --to de` builds the prompt from project state:

1. **Task**: translate N keys from `en` to `de`.
2. **Rules**: keep placeholders exactly (list of syntaxes found in the project, from `placeholders` plugins), keep markup tags, keep the tone of existing `de` messages, do not translate glossary terms marked `doNotTranslate`, keep plural forms as the library expects (preset adds library-specific notes, for example i18next suffix rules or ICU plural categories for `de`).
3. **Glossary**: config `glossary` entries with their `de` translation.
4. **Style reference**: up to K existing `de` messages from the same namespaces, as examples. A copy of the source is never an example: it says nothing about `de`, and tells the model that copying is fine.
5. **Items**: for each key: key, source value, placeholders, existing value (when re-translating), the reports of checks on it (`issues`, with `--check`), max length when configured, and **usage context**: file path and a few lines of code around up to 2 usages. Context helps with short ambiguous strings like "Open" or "Save".
6. **How to write results**:
   - Write a JSON file `{ "de": { "<key>": "<translation>" } }` and run `x18n apply <file> --json`, or run `x18n set <key> --locale de --value <text>` per key.
   - Then run `x18n check --only placeholder-mismatch,invalid-syntax --locale de --json` and fix any reported keys.
   - To find more work: `x18n keys --missing de --json --limit 50`.

Options: `--keys <glob>`, `--namespace`, `--limit` (default 50 items; prompt says how many remain and how to get the next batch), `--format markdown|json` (JSON gives the same parts as data for tools that build their own prompt), `--no-context`, `--stale`, `--check [ids]`.

The prompt holds keys without a value. `--stale` adds stale translations ([19-history.md](./19-history.md)). `--check` adds values that enabled checks report in the target locale (all checks, or the listed ids), such as copies of the source (`identical-to-source`), so a value that never became empty can still be re-translated. A rule tells the model to leave out a value that is right as it is. Missing and empty values carry no `issues`: they are on the page anyway.

Plugins can change the prompt with the `translatePrompt` hook (add rules, add examples). The prompt text is plain markdown, with no provider-specific syntax.

The same builder serves:

- `x18n prompt translate` (CLI),
- MCP prompt `translate` and tool `x18n_translate_prompt`,
- the UI button "Copy translate prompt" (per locale, per selection, per key),
- the VS Code commands and hover links: copy, or hand to the editor's chat agent (D39).

`x18n prompt review --locale de` is the same idea for checking existing translations. With reviews on (the default), the agent leaves `x18n review request-change` comments or `x18n review suggest` values for a human to accept; with `review.enabled: false` it fixes values with `x18n set` and lists what it changed. MCP agents use the `x18n_review` and `x18n_reviews` tools.

## MCP

Through devframe's MCP adapter (`@devframes/agentic`), from the same devframe definition as the UI:

- `x18n mcp` serves stdio.
- `x18n ui` also mounts Streamable HTTP MCP at `/__mcp` on loopback, behind the bearer token that `x18n ui` prints. An agent can then work next to a human using the UI, and both see the same state.

Tools are the RPC functions marked `agent` in [09-ui.md](./09-ui.md), with descriptions written for agents:

| Tool | Purpose |
| --- | --- |
| `x18n_status` | Locales, coverage, diagnostics summary. |
| `x18n_keys` | Keys with filters (`missing`, `unused`, `namespace`, glob), paged. |
| `x18n_search` | Keys by value in any locale (fuzzy, or `exact`), with usages; paged. |
| `x18n_get` | One key with values, usages and reviews. |
| `x18n_usages` | Usages of a key. |
| `x18n_check` | Run checks, return diagnostics. |
| `x18n_translate_prompt` | Prompt for a locale or key set. |
| `x18n_set_messages` | Batch set, same shape as `x18n apply`; returns placeholder problems instead of writing when found. |
| `x18n_rename_key`, `x18n_delete_key` | Return the plan; a second call with `confirm: true` applies it. |
| `x18n_extract_plan`, `x18n_extract_apply` | Two-step extraction. |
| `x18n_reviews`, `x18n_review` | List review threads; leave a comment, approval, change request or suggestion for a human. |

MCP prompts: `translate`, `review`, `extract`.

## Shipped skills

The source is the root `skills/` directory, so `skills add x18n-dev/x18n` finds it on GitHub. The `@x18n/cli` build copies it into the package (like devframe ships its skill), where `skills-npm` discovers it at the installed CLI's version. Three skills, each with its own trigger, with no text shared between them:

- `x18n-setup`: `x18n doctor`, `x18n init` only when detection needs help, the dev dependency and script, and the first `x18n check` summary. Holds `references/migrate-i18n-ally.md`.
- `x18n-check`: run `x18n check --json`, fix diagnostics per check id, and bring unused-key deletes, glossary terms, check severities and `--strict` to the user.
- `x18n`: the day-to-day skill, below.

`x18n` content:

- When to use x18n instead of editing locale files.
- The loops: "add a key while coding" (`x18n set` in source locale, then `x18n keys --missing`), "translate missing" (prompt, apply, check), "clean up" (`x18n keys --unused`, `x18n delete --dry-run`), "extract strings" (list, plan, apply).
- Reading `--json` output, paging, exit codes.
- What not to do: write locale files directly, invent keys without checking `x18n get`, drop placeholders.

## Tests

- Prompt snapshots on fixture projects.
- A test that every command named in a prompt or in the skill exists and accepts the flags used (parse the text, run the CLI with `--help`).
