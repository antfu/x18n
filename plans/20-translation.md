# 20 - Machine translation (1.x)

x18n can translate messages itself, through **translators**: plugins that turn a batch of source messages into target messages. Core owns everything around the call: which messages to translate, the context they carry, placeholder protection, batching, checks on every output, retries, provenance and the write. A translator only talks to its service. This replaces D9 (D46). User docs: [`docs/content/1.guide/6.machine-translation.md`](../docs/content/1.guide/6.machine-translation.md).

The design takes from [diglot](https://github.com/danielroe/diglot)'s `@diglot/mt` (model-neutral LLM calls with structured output, id-matched replies, model-free QA with one retry, minimal updates from a word diff, glossary terms only when they occur) and avoids the weak points of [i18n-ally-next](https://github.com/Lydanne/i18n-ally-next)'s engines (one settings block per vendor, prompts without context, replies parsed by regex with a line-by-line fallback, no checks on output).

## Principles

- **Core names no service.** Translator ids like `deepl` or `ai` exist only in plugins. Core calls `translate` on an interface (rules 1 and 2 of [01-architecture.md](./01-architecture.md)).
- **One selection, two outlets.** The items of a translation run are the items of a translate prompt ([10-agents.md](./10-agents.md)): same options (`keys`, `namespace`, `stale`, `check`), same context. An agent and a translator see the same work.
- **No output is trusted.** Every candidate passes checks before it can be written. A failed candidate is retried once with its problems, then handed to the next translator, then rejected. Rejections are data, never silent drops.
- **Machine output is marked.** Written values carry provenance in the review file. A human edit or an approval clears the mark (D47).
- **Human translations are not overwritten by default.** Missing and empty messages get values; existing values (stale, reported by checks) get review suggestions unless the run says `overwrite`.
- **Plan, then run, then apply.** Planning calls no translator and returns an estimate. Surfaces confirm before spending (rule 5). The run returns a normal `Plan`, applied like any other edit.
- **No keys in files.** Translators resolve secrets through the host (`ctx.secret({ env: 'DEEPL_API_KEY' })`).

## API

The types are in [`packages/core/src/types/translate.ts`](../packages/core/src/types/translate.ts); this section gives the shape and the reasons.

- **Capability.** `Plugin.translators` contributes `Translator`s, unique by id (`X18N1002` for a duplicate, unless `override`). `Plugin.transformTranslation` changes a candidate before the checks run (typography, casing), in plugin order. `defineTranslator` keeps literal ids.
- **`Translator`**: `id`, `features`, optional `supports({ from, to }, ctx)` (async, for services that list languages), optional `fingerprint` (changes when options that change output change; part of the cache key), and `translate(batch, ctx)`.
- **`TranslatorFeatures`** say what core sends: `placeholders` (`'xml'` masks each as `<x id="0"/>`, `'token'` as `⟦0⟧`, `'raw'` sends the text with a placeholder list), `context` (descriptions, usages, related values, examples, rules), `feedback` (can use the problems of a failed try), `update` (can update from a word diff), `glossary` (`'native' | 'prompt' | 'none'`), `batch` (`maxItems`, `maxChars`), `concurrency`, and `paid` (surfaces confirm paid runs).
- **`TranslatorContext`**: `secret(ref)` resolves a `SecretRef` (`{ env }` through `Host.env`, which the node host reads from `process.env`), `logger`, and `cache` for the translator's own data.
- **`TranslateBatch`**: `from`, `to`, both `LocaleInfo`s, `items`, the `glossary` entries whose term occurs in the batch, `rules` (prompt rules and notes, presets' `translatePrompt` hooks, config `translate.rules`), `examples`, `subject`, the `prompt` core renders for LLMs (`system`, `user`, `version`), and an `AbortSignal`.
- **`TranslateItem`**: a batch-local `id`, `key`, the masked `text`, its `placeholders`, and with `context` the description, usage snippets and related values. A stale item of a translator with `update` gets `previous` (old source, old translation, word diff); a retried item gets `retry` (last output, problems).
- **Reply**: `{ items: [{ id, text, declined? }], usage?, model? }`. An id missing from the reply is a failure, never a guess by position. An unknown id is ignored; a duplicate keeps the first. A thrown error fails the batch and moves its items to the next translator.

`renderTranslatorPrompt` (core) renders the batch for LLMs: the rules and terminology in `system`, the items as JSON in `user`, and a reply schema `{"translations": [{"id", "text"}]}`. `TRANSLATOR_PROMPT_VERSION` is recorded in provenance and the cache key; bump it when the prompt changes output.

## Project API

```ts
interface Project {
  /** Selects, routes and estimates. No translator is called. */
  readonly planTranslation: (options: TranslationOptions) => Promise<TranslationJob>
  /** Runs a planned job: events stream as batches finish; `result` holds the plan to apply. */
  readonly translate: (job: TranslationJob, options?: { readonly signal?: AbortSignal }) => TranslationRun
  /** Where a machine-translated message came from, while no human changed or approved its value. */
  readonly machine: (key: KeyString, locale: LocaleCode) => MachineRecord | undefined
  readonly translators: ReadonlyMap<string, Translator>
}
```

- `TranslationOptions`: `to` (locales or `'all'`), the prompt selection (`keys`, `namespace`, `stale`, `check`), `translators` (ids, or translator objects a surface brings), `write` (`'value' | 'suggestion' | 'none'`), `overwrite`, `limit`, `budget` (`usd`, `characters`), `retries`, `cache`, `retryRejected`.
- `TranslationJob`: `id`, `revision`, `items` (key, locale, first translator, kind `fresh | update | cached`), `skipped`, and an `estimate` per translator (items, characters, batches, paid). `translate` refuses a job from an older revision (`X18N4004`) or from another project.
- `TranslationResult`: `candidates` (value, translator, `derived`, warnings, `write`, `cached`), `rejected` (translators tried, last output, issues), `skipped`, `usage` per translator, `cancelled`, and the `plan`.
- Skip reasons: `unsupported-pair`, `read-only`, `limit`, `budget`, `cached-rejection`, `cancelled`, and `kept` (a message reported by a check that the translator left out, as the rules allow).

## Pipeline

1. **Select.** `project.prompt('translate', locale, ...)` per target locale, so the selection is the prompt's. `limit` (default config `translate.limit`, 200) counts over all locales. Read-only resources are skipped.
2. **Route.** The chain of a locale is `options.translators`, else config `translate.locales[locale]`, else `translate.translators`, else every translator of the plugins in plugin order. An unknown id is `X18N6002`; an empty chain is `X18N6001`. Translators whose `supports` says no are dropped; with none left, items are skipped as `unsupported-pair`.
3. **Reuse.** The host cache answers items it has seen: same chain (ids and fingerprints), pair, prompt version, source, description and, in update mode, old source and translation. Cached rejections are skipped until one of those changes, unless `retryRejected`.
4. **Deduplicate.** Items with the same source, description, kind and existing value in one locale are sent once and fanned out. Existing translations of the same source under other keys are not reused: short strings ("Open", "Close") need different translations in different places.
5. **Protect.** Placeholders are found by the project's placeholder syntaxes and masked as the translator wants. The same placeholder text shares one token. Overlapping matches keep the outer one.
6. **Batch.** By translator and locale, then namespace. Batches are split evenly under `maxItems` and `maxChars`.
7. **Call.** Up to `concurrency` batches per translator. Before each batch, a paid translator stops at the budget, and an aborted signal stops the run; their items are skipped as `budget` or `cancelled`.
8. **Restore and transform.** Tokens become placeholders again; `transformTranslation` hooks run.
9. **Verify.** Model-free checks: an empty value, a leftover token, placeholders that differ from the source (`placeholder-mismatch`), new syntax errors (`invalid-syntax`, from `PlaceholderSyntax.validate`), and every check with a `message` method at its configured level (`strict` turns warnings into errors). An error fails the item; warnings stay on the candidate.
10. **Retry or fall through.** A failed item goes back to the same translator with its problems when `feedback` is true (`retries`, default 1), else to the next translator. When the chain runs out it is rejected, and the rejection is cached.
11. **Plan.** Candidates become `set` ops with `machine` provenance, or `review` suggestions authored by `x18n translate (<translator>)`. Without a review file, a suggestion is not written (`write: 'none'`).

### Message checks

`Check.message(input)` judges one candidate value without the project: key, locale, value, source, both locale infos, a placeholder finder, the glossary and the check's options. `identical-to-source` has one. A translation run calls it on every output, so a run rejects what `x18n check` would report as an error.

## Provenance

A `set` op with `machine` (`translator`, `model`, `prompt`; `time` is filled in when planned) records a `MachineRecord` in the review file's `machine` section, creating the file when it is missing, and records the source hash as written ([12-reviews.md](./12-reviews.md)). The record holds the hash of the written value. `project.machine(key, locale)` returns it while the current value has that hash and no open approval approved that value; the flag is derived on read (D41), so a hand edit, a pull or an approval clears it. Renames and deletes move and drop records with the threads. With `review.enabled: false`, nothing is recorded.

## Config

```ts
export default defineConfig({
  translate: {
    translators: ['ai'], // default: every translator of the plugins, in plugin order
    locales: {
      ja: ['ai']
    }, // chain per target locale
    subject: 'the UI of Acme, a project management app',
    rules: {
      '*': ['Keep UI labels short.'],
      'de': ['Address the user as "du".']
    },
    limit: 200,
    budget: { usd: 5 },
    retries: 1,
    cache: true,
  },
})
```

Translators come from plugins, so YAML and JSON configs add them with `[specifier, options]`: `['@x18n/translator-ai', { model: 'anthropic/claude-sonnet-5-5' }]`. Pricing for providers that report no cost is an option of the translator, not of `translate`.

## Translators we ship

| Translator | Package | Status |
| --- | --- | --- |
| `ai` | `@x18n/translator-ai` | Shipped. Any AI SDK `LanguageModel`, or a model id string for the AI SDK default provider. Sends `batch.prompt` with structured output. Options: `model`, `id`, `maxItems` (40), `concurrency`, `temperature`, `maxRetries`, `pricing`. A reply that does not match the schema fails its items, which core retries. |
| `deepl` | `@x18n/builtins` | Planned. Tag handling `xml`, native glossaries kept in `ctx.cache`, `formality`, description as `context`. |
| `google` | `@x18n/builtins` | Planned. Cloud Translation, tag handling `html`. |
| `vscode-lm` | `x18n-vscode` | Planned, as a [client translator](#client-translators). |

No translation memory and no pseudo translator: a run already sends repeated text once, and tests use fake translators. Pseudolocalization, if it comes, is a command of its own.

## Surfaces

| Surface | Status |
| --- | --- |
| CLI | Shipped: `x18n translate --to <locales\|all>` with `--keys`, `--namespace`, `--stale`, `--check [ids]`, `--translator`, `--limit`, `--budget-usd`, `--write`, `--overwrite`, `--retry-rejected`, `--estimate`, `--dry-run`, `--json`; the global `--no-cache` turns the cache off. Paid runs ask on a TTY unless `--yes`. Exit code 1 when items are rejected. `x18n translators` lists translators, features and the chain per locale. |
| LSP | Planned: `x18n/translatePlan` and `x18n/translate` with `$/progress` and cancellation, a "Translate" quick fix on `missing-translation`, a hover link per missing locale. |
| VS Code | Planned: "Translate Key", "Translate Missing in Locale", "Translate Selection", a picker of the chain and the client translator, the estimate confirm, a cancellable progress notification, machine-translated messages marked in annotations and hovers. "Translate with Agent" (D39) stays. |
| UI | Planned: a translate panel (locales, selection, chain, estimate, live progress, candidate table to accept or reject per row, "Apply and approve"), a machine badge and filter in the keys grid. |
| MCP | Planned: `x18n_translate`. |
| CI | Works with the CLI: `x18n translate --to all --json`, with the host cache kept between runs (`.x18n/cache`), then `x18n check`, then commit. |

### Client translators

An editor can bring its own model. The VS Code client advertises `{ id: 'vscode-lm', features }` in the LSP `initialize` options, and the server passes a proxy translator in `TranslationOptions.translators` whose `translate` sends `x18n/translator/translate` (the batch without `signal`, with a request id for cancellation) to the client. The client calls `vscode.lm` with `batch.prompt` and returns the reply. Masking, checks, retries and provenance stay in the server.

## Wire contracts

- Shipped: `x18n translate --json` (`estimate`, `candidates`, `rejected`, `skipped`, `usage`, `cancelled`, and the plan fields of every write command; with `--estimate`: `items`, `skipped`, `estimate`, `estimated: true`), `x18n translators --json`, `x18n review approve --json` in batches (`approved`, `skipped`), and the `machine` section of the review file schema. Covered by CLI tests and the tsnapi API snapshot.
- Planned: LSP `x18n/translatePlan`, `x18n/translate`, `x18n/translator/translate`; RPC `x18n:translate-plan`, `x18n:translate`; MCP `x18n_translate`.

## Tests

- `packages/builtins/test/translate.test.ts` runs the pipeline against fake translators: writes and provenance, suggestions and `overwrite`, retry with problems and fall-through, rejection caching, missing ids, cache answers, xml masking, batching and budget, the item limit, `supports` and glossary filtering, message checks, unknown translators, stale jobs, and batch approval.
- `packages/translator-ai/test` drives `@x18n/translator-ai` with the AI SDK's `MockLanguageModelV4`.
- `packages/cli/test/cli.test.ts` runs `x18n translate`, `x18n translators` and `x18n review approve --machine` on a fixture with a fake translator plugin.

## Next

1. `deepl` and `google` translators, with recorded-response tests.
2. LSP and VS Code, with the client translator; UI panel; MCP tool.
3. Translation states written by formats: `set` and `MessageOp` gain `state`, so a machine value is `needs-review` in XLIFF and PO, and an approval writes `reviewed`.
4. More message checks: `leaked-instructions`, `placeholder-like`, `number-mismatch`, `length-ratio`, `glossary-term`, `max-length`; glossary `match` and `accept`.
5. Plural expansion for derived plural keys: one item per CLDR category the target needs, from the nearest source form.
6. `matches`: existing translations of the same source under other keys, as hints.
