---
name: x18n-check
description: Run `x18n check` and fix what it reports - missing keys and translations, placeholder mismatches, invalid message syntax, unused keys, glossary violations. Use when the user asks to check, lint or fix translations, when `x18n check` fails locally or in CI, or before opening a PR that touches locale files or translation keys.
---

# Check and fix translations

`x18n check` reports broken, untranslated and unused messages, like `tsc --noEmit` for i18n. Run it, fix the routine problems, and bring the rest to the user. Change locale files only through the `x18n` CLI (`set`, `apply`, `rename`, `delete`), never by hand. The `x18n` skill covers those commands.

If the project has no x18n setup yet, use the `x18n-setup` skill first.

## Decisions belong to the user

Before you act on one of these, stop and ask, with your recommendation and the facts you found. Batch the questions into one message.

- deleting keys reported as unused, since keys built at runtime look unused too
- a glossary term and its translation per locale
- changing the severity of a check in the `checks` map of the config, such as `'unused-key': 'error'` or `glossary: 'warning'`
- making warnings fail CI with `--strict` or `--max-warnings <n>`

## Loop

1. Run `x18n check --json`. Read `data.projects[].summary` for the counts and `diagnostics` for the problems. Group the diagnostics by `code` and `severity`. **Done when** you know the count per check, errors first.
2. Fix the errors, check by check, with the table below. Re-run only that check to confirm: `x18n check --only placeholder-mismatch --json`. **Done when** the summary shows no errors, or each remaining error waits on a user decision.
3. Fix the warnings you can fix without a decision, such as missing translations. **Done when** the remaining warnings each need a decision.
4. Ask the user about the remaining diagnostics in one message: list them by check, with your recommendation for each. Apply what they decide.
5. Run `x18n check --json` again and report the result. **Done when** `x18n check` exits with code 0, or every remaining diagnostic is one the user chose to keep.

## Fixes per check

| Check (`code`) | Fix |
| --- | --- |
| `missing-key` | A usage names a key the source locale lacks. If it is a typo, fix the usage to an existing key (`x18n keys` lists them). Else add it: `x18n set <key> --value <text> --json`. |
| `missing-translation`, `empty-translation` | Translate: `x18n prompt translate --to <locale> --limit 50`, write the result to a file, then `x18n apply <file> --json`. Follow `nextCursor` when the prompt reports more keys. |
| `placeholder-mismatch` | Rewrite the target value with every placeholder of the source: `x18n set <key> --locale <locale> --value <text> --json`. |
| `param-mismatch` | A call passes other params than the source message's placeholders read. Fix the call, or the source message with `x18n set`. Ask when it is unclear which one is wrong. |
| `invalid-syntax` | Fix the message syntax (ICU braces, linked messages) with `x18n set`. When a linked message does not exist, fix the link or add that key. |
| `key-conflict` | A key is both a message and a parent, or is defined twice in one locale. Ask which one to keep, then `x18n rename` or `x18n delete` with `--dry-run` first. |
| `unused-key` | Show the list from `x18n keys --unused --json` and delete only the keys the user confirms: `x18n delete <key> --dry-run --json`, then without `--dry-run`. Keys built at runtime go in `usage.keysInUse` in the config instead. |
| `redundant-translation` | The message repeats what its fallback locale (`localeFallbacks`) already says. Delete it with `x18n delete <key> --locale <locale> --dry-run` first, then without `--dry-run`. |
| `glossary` | Rewrite the message with the term from the glossary (`x18n doctor --json` lists it under `config.glossary`), with `x18n set`. For many messages: `x18n prompt translate --to <locale> --check glossary`. |
| `stale-translation`, `identical-to-source` | Re-translate: `x18n prompt translate --to <locale> --check stale-translation,identical-to-source --limit 50`, then `x18n apply <file> --json`. The prompt shows what was reported for each value. Leave out values that are right as they are, such as a word that is the same in both languages, and list them for the user. |
| `locale-code-conflict`, `dynamic-key`, `key-style`, `hard-string` | Report them. Fix only when the user asks; `hard-string` is fixed with `x18n extract`, or silenced with an `x18n-ignore` control comment when the string is not UI text. |

After a batch of fixes, check only what you touched: `x18n check --only placeholder-mismatch,invalid-syntax,glossary --locale de --json`.

## CI

`x18n check` exits with code 1 on errors, so CI fails on broken keys without more setup. Warnings do not fail it unless the project uses `--strict` or `--max-warnings <n>`. For pull request annotations, use `x18n check --reporter github --reporter pretty`. Change none of this without asking.
