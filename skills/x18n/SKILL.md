---
name: x18n
description: Manage a project's translations with x18n (`@x18n/cli`). Use when the task touches locale files or translation keys - adding, renaming or deleting keys, finding the key behind a text shown in the app, finding missing or unused keys, translating missing messages, reviewing translations, extracting hard-coded strings, keeping a glossary of terms.
---

# x18n

x18n reads a project's i18n setup (locale files, translate calls in code) and changes it safely. Work through the `x18n` CLI from `@x18n/cli`: it keeps formatting, key style, file choice and placeholders correct, and every command prints a stable JSON envelope with `--json`.

## Decisions belong to the user

You do the legwork; the user makes the **decisions** that shape the product. Before you act on one of these, stop and ask, with your recommendation and the facts you found:

- the source locale, and which locales the project supports
- key naming and structure: namespaces, nesting, the style of new keys
- a glossary term and its translation per locale, and terms that must stay untranslated (brand and product names)
- tone and formality per locale (German *du* or *Sie*, French *tu* or *vous*)
- deleting keys that look unused, since keys built at runtime look unused too
- renames that touch many files or move keys between namespaces

Batch the questions into one message. Routine work needs no question: adding a key you use, translating a missing message, fixing a placeholder.

## Rules

- Change locale files through `x18n set`, `x18n apply`, `x18n rename` and `x18n delete`. The config file (`x18n.config.ts`) is the one i18n file you edit by hand.
- Check a key before you use it in code: `x18n get <key> --json`. Reuse an existing key with the same meaning: `x18n search "<text>" --json` finds keys whose value already says it.
- Keep every placeholder of the source message (`{name}`, `{{count}}`, `%{name}`, `:name`, `%s`, `@:key`).
- Pass `--json` and read the envelope `{ "x18n": 2, "command", "data", "diagnostics", "errors" }`.
- Run renames and deletes with `--dry-run` first, and read the plan.
- Write every key as a full string literal. Do not build keys at runtime (see below).

## Avoid composed keys

Do not build a key from parts, such as `` t(`foo.bar.${name}`) `` or `t('foo.bar.' + name)`. x18n and the compiler cannot see the full key, so:

- `x18n keys --unused` reports the key as unused, and `x18n delete` can remove a message that the code needs
- `x18n rename` does not update the usage
- `x18n check` cannot find a missing message until the user hits it at runtime
- translators cannot see the full key in context

Write each key out in full and map the value to it:

```ts
// Avoid
t(`status.${status}`)

// Prefer: a lookup of full literal keys
const labels = {
  active: t('status.active'),
  paused: t('status.paused'),
} as const
labels[status]
```

```ts
// Avoid
t(`plans.${plan}.title`)

// Prefer: a switch, or a record of functions when the call must be lazy
const planTitle = {
  free: () => t('plans.free.title'),
  pro: () => t('plans.pro.title'),
}
planTitle[plan]()
```

When the variable part is only a word inside a sentence, use a placeholder instead of a key part: `t('greeting', { name })` with the message `Hello, {name}`. When the text differs by count, use the library's plural syntax, not `t(count === 1 ? 'item.one' : 'item.many')`.

If the user's code already composes keys, do not rewrite it unasked. Tell the user which keys are affected, and treat those keys as used when you clean up.

## Set up and check

- To set up x18n, or migrate from i18n-ally, use the `x18n-setup` skill.
- To run `x18n check` and fix what it reports, use the `x18n-check` skill.

Commands below use `x18n`; without the dev dependency, run them as `npx @x18n/cli <command>`.

## Glossary (terms table)

The `glossary` in the config is the project's terms table. Translate prompts include it, and the `glossary` check reports messages that translate a term differently.

```ts
// x18n.config.ts
import { defineConfig } from '@x18n/core'

export default defineConfig({
  glossary: [
    {
      term: 'Workspace',
      translations: { de: 'Arbeitsbereich', fr: 'Espace de travail' }
    },
    { term: 'x18n', doNotTranslate: true },
    {
      term: 'Save',
      translations: { de: 'Speichern' },
      note: 'The button label, not "rescue"'
    },
  ],
  checks: { glossary: 'warning' },
})
```

Maintain it while you work:

- Before you translate, read the current entries: `x18n doctor --json` lists them under `config.glossary`.
- When you meet a term that recurs across messages or has a product meaning, propose an entry to the user, with a translation for each locale.
- Add the entries the user approves, then run `x18n check --only glossary --json` and fix the messages it reports.

## Loops

### Find the key behind a text

When the user names a text they see in the app, and not a key, search the values:

```sh
x18n search "Sign in" --json
x18n search "Anmelden" --exact --json
```

The search covers every locale and ignores case. It is fuzzy by default, and values that contain the query rank first. `--exact` keeps only those. Each match in `data.projects[].matches` has `key`, `locale`, `value` and `usages` (`file`, `line`, `column`), so you can open the code that shows the text.

### Add a key while coding

```sh
x18n search "Settings" --exact --json
x18n get settings.title --json
x18n set settings.title --value "Settings" --json
x18n keys --missing de --json --limit 50
```

Reuse a key that `x18n search` finds with the same meaning. `x18n set` without `--locale` writes the source locale. Then use the key in code, for example `t('settings.title')`.

### Translate missing messages

```sh
x18n prompt translate --to de --limit 50
```

Follow the prompt. It holds the rules, the glossary, examples of existing translations and the code around each usage. Write `{ "de": { "<key>": "<translation>" } }` to a file, then:

```sh
x18n apply translations.json --json
x18n check --only placeholder-mismatch,invalid-syntax,glossary --locale de --json
```

`x18n apply` refuses values whose placeholders differ from the source and lists them in `data.rejected`. Fix them and apply again. When the prompt reports more keys, continue with `x18n prompt translate --to de --cursor <nextCursor>`.

The prompt lists missing and empty messages. Two flags add messages that already have a value:

- `--stale`: translations older than their source message (needs git history). Each one shows the source text from when the translation last changed.
- `--check`: values that checks report in the target locale, such as a copy of the source text (`identical-to-source`) or a wrong glossary term (`glossary`). Each one shows what was reported. `--check identical-to-source,glossary` limits it to those checks. Leave out a value that is right as it is, such as a word that is the same in both languages.

### Review translations

```sh
x18n prompt review --locale de --limit 50
```

Do not change values yourself. For each wrong translation, leave a review for a human to accept, then list what you reviewed:

```sh
x18n review suggest <key> --locale de --value <better text> --text <why> --json
x18n review request-change <key> --locale de --text <why> --json
```

Keep every placeholder in a suggested value. `x18n review list --locale de --open --json` shows the open reviews. Only when the user asks, apply one with `x18n review apply-suggestion <id> --json`. When reviews are off (`review.enabled: false`, error X18N5003), fix values with `x18n set <key> --locale de --value <text> --json` instead.

### Clean up

```sh
x18n keys --unused --json
x18n delete old.key --dry-run --json
```

Show the user the unused keys and delete only the ones they confirm: `x18n delete old.key --json`.

### Rename keys

```sh
x18n rename home.title home.heading --dry-run --json
x18n rename home.title home.heading --json
x18n rename pages screens --json
```

A rename updates every locale and every usage in code. Renaming a parent (`pages`) moves every key under it. A rename onto an existing key is refused (exit code 1).

### Extract hard-coded strings

```sh
x18n extract --list --json
x18n extract --plan extract-plan.json
x18n extract --apply extract-plan.json --json
```

Edit the keys in the plan file before you apply it. The proposed keys follow the project's style; ask the user when there is none yet.

Tests, fixtures, mocks, stories, configs and type declarations are never scanned, in any language (`*.test.ts`, `*_test.go`, `test_*.py`, `*_spec.rb`, `*Test.java`, `vite.config.ts`, `tests/`, `spec/`, `e2e/`, ...). To keep strings that are not UI text out of the plan, drop them from the plan file, or add a control comment to the code:

| Comment | Skips |
| --- | --- |
| `x18n-ignore-file` | the whole file, wherever the comment is |
| `x18n-ignore-start` ... `x18n-ignore-end` | everything between them (to the end of the file when unclosed) |
| `x18n-ignore` | strings on its line and on the next line |

Use any comment syntax: `// x18n-ignore-file`, `<!-- x18n-ignore -->`. For strings that recur across files, use `extract.ignore` in the config instead.

## Output

Exit codes:

- `0` success
- `1` `x18n check` found errors, or `x18n apply` rejected values
- `2` usage or config error
- `3` a decision is needed: re-run with `--yes` to accept the defaults
- `4` files changed during the command: run it again

List commands take `--limit` and return `nextCursor`; pass it as `--cursor` to get the next page: `x18n keys --json --limit 100 --cursor 100`.

When `x18n status --json` lists several projects (a monorepo), pass `--project <name>` to write commands.
