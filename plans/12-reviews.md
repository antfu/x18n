# 12 - Reviews (1.x)

Comments, approvals, change requests and suggested values on messages. A port of i18n-ally's review system, moved out of `.vscode/` and made usable from every surface. Reviews shipped in M12. `x18n migrate i18n-ally` converts `.vscode/i18n-ally-reviews.yml` to `.x18n/reviews.yml`, so existing reviews carry over.

## Storage

Default file `.x18n/reviews.yml` (`review.file`), tracked in git, so reviews travel with the branch and show up in PR diffs. Its schema is `ReviewFileSchema` in core, published as `schema/reviews.json`.

```yaml
# yaml-language-server: $schema=https://x18n.dev/schema/reviews.json
x18n: 1
threads:
  'auth:login.title':
    de:
      - id: r8f2k1
        type: request-change # comment | approve | request-change | suggestion
        author: {name: Ada, email: ada@example.com}
        time: '2026-10-15T09:12:00Z'
        text: Too formal, use "Anmelden".
        suggestion: Anmelden # only for type: suggestion
        value: Einloggen # only for type: approve, the value it approved
        resolved: false
sources:
  'auth:login.title':
    de: 9f2c1a # hash of the source value when de was last written
```

- Keyed by `KeyString`, then locale. Stable order (sorted keys and locales) so concurrent edits merge well.
- `id` is a short random id, unique within the file. `project.plan` fills in `id` and `time` of new reviews, so planning again after decisions writes the same comments.
- Author comes from config `review.author`, else `host.identity()` (git `user.name` and `user.email` in the node host); the CLI also takes `--author`.
- When a key is renamed through x18n, its threads and records move with it in the same plan. When a key is deleted, they are removed in the same plan.
- An approval stores the value it approved. It is stale when the message has another value; the flag is derived on read (`ThreadComment.stale`), so hand edits and pulls count too.
- A file that does not parse is reported as `invalid-resource` with X18N5001, and x18n writes no reviews until it is fixed, so a write never drops what the file holds.

## Thread state

The last open `approve` or `request-change` decides (`approved`, `stale-approval`, `changes-requested`); without one, an open suggestion makes it `suggested`, then an open comment `commented`. A thread whose comments are all resolved has no state. `resolve` marks a comment `resolved: true`; it stays in the file.

## Stale translations

Stale translations come from history providers ([19-history.md](./19-history.md)); git works without any records. Review records cover changes that git cannot see:

- Once the project has a review file, every x18n write of a non-empty target value (`set`, `apply`, an accepted suggestion, a translate prompt batch) records the hash of the source value for that key and locale, in the same plan. A source set in the same plan counts with its new value.
- A recorded hash that matches the current source value makes the target fresh, whatever the providers say; `x18n review mark-fresh <key> [--locale]` records the current hash without a change. A record has no time, so it is not a history provider: a mismatch leaves the decision to the providers.
- Renames and deletes move or drop the records with the threads.

## Store and ops

```ts
interface ReviewStore {
  readonly id: string
  readonly parse: (text: string) => ReviewData
  readonly serialize: (data: ReviewData) => string
}
```

Core reads and writes the file through the host and puts review writes into the edit plan (D41). The YAML store is the built-in one (`x18n:reviews` in `@x18n/builtins/reviews`). A plugin can add another through `reviewStores`; the last store is the active one, so a plugin's store replaces the built-in one.

A plugin that keeps its own review state (a `verified` field beside each message) reacts with the `reviewEdit` hook. Core calls it for each `review`, `resolve-review` and `apply-suggestion` edit of a plan, after the edit is applied to the review data, with the comment, the thread and the files as the plan leaves them. The hook returns full file contents, which core puts into the same plan.

Edit ops: `review` (`{ key, locale, review, text?, suggestion?, author? }`), `resolve-review` (`{ id }`), `apply-suggestion` (`{ id }`: sets the value and resolves it), `mark-fresh` (`{ key, locales? }`). Reads: `project.reviews(filter)`, `KeyInfo.reviews`, `CheckContext.reviews`.

## Batch approval

Machine translation ([20-translation.md](./20-translation.md)) writes many values marked `needs-review` at once, so reviewers need to approve many at once too. A batch approval is one plan of `review` ops of type `approve`, one per message, chosen by a query and guarded so that nobody approves something they did not see.

### What an approval writes

For one message or many, an approval:

- adds an `approve` review that stores the approved value, as today;
- (planned, with state writes in [20-translation.md](./20-translation.md#next)) sets the message's translation state to `reviewed` in formats that record state (XLIFF `state="reviewed"`, PO drops `fuzzy`);
- clears the machine-translated flag, which is derived: the provenance record stays, and an approval of the current value outranks it (D41, [20-translation.md](./20-translation.md#provenance)).

With `stale: 'mark-fresh'`, it also adds a `mark-fresh` op for the message, so an approved stale translation stops being stale.

### Query and plan

The types are `ApprovalQuery`, `ApprovalPlan` and `ApprovalSkip` in [`packages/core/src/types/review.ts`](../packages/core/src/types/review.ts).

```ts
interface Project {
  readonly planApprovals: (query: ApprovalQuery) => ApprovalPlan
}

interface ApprovalQuery {
  readonly locales: readonly LocaleCode[] | 'all'
  /** Key glob: `*` inside a segment, `**` across segments. */
  readonly glob?: string | undefined
  readonly namespace?: string | undefined
  /** Only machine-translated messages; with a translator id, only its output. */
  readonly machine?: boolean | string | undefined
  /** Only messages whose format records this state. */
  readonly state?: 'needs-review' | 'translated' | undefined
  /** Only messages whose review thread has this state. */
  readonly thread?: 'suggested' | 'commented' | 'stale-approval' | undefined
  /**
   * The exact values the reviewer saw. A message whose value differs is skipped with `value-changed`.
   * Surfaces that show values (UI, VS Code) MUST pass them; the CLI passes them from `--from <file>`.
   */
  readonly values?: readonly { readonly key: KeyString, readonly locale: LocaleCode, readonly value: string }[] | undefined
  /** How to treat stale translations: skip them (default), approve them as they are, or approve and mark them fresh. */
  readonly stale?: 'skip' | 'approve' | 'mark-fresh' | undefined
  /** Approve messages whose thread has an open change request. Default false. */
  readonly overrideChangeRequests?: boolean | undefined
  /** Text added to every approval. */
  readonly text?: string | undefined
  readonly author?: ReviewAuthor | undefined
  readonly limit?: number | undefined
}

interface ApprovalPlan {
  readonly plan: Plan
  /** Sorted by key, then locale. */
  readonly approved: readonly { readonly key: KeyString, readonly locale: LocaleCode, readonly value: string, readonly machine: string | undefined }[]
  readonly skipped: readonly ApprovalSkip[]
}

interface ApprovalSkip {
  readonly key: KeyString
  readonly locale: LocaleCode
  readonly reason:
    | 'empty' // nothing to approve
    | 'already-approved' // an open approval already holds this value
    | 'value-changed' // differs from `values`
    | 'failing-check' // a blocking message check fails on the value (placeholder-mismatch, invalid-syntax, ...)
    | 'changes-requested' // open change request, without `overrideChangeRequests`
    | 'stale' // stale translation, with `stale: 'skip'`
    | 'read-only'
    | 'limit'
}
```

Rules:

- The query MUST narrow the selection. A query with only `locales` and no other filter, `values` or `glob` is refused with `X18N5006` unless the caller sets `glob: '**'`, so "approve everything" is never the default.
- The source locale is never approved; `locales` defaults to every other locale. Messages the filters leave out are not skips; only selected messages that are not approved are listed, with their reason.
- `failing-check` is the placeholder and syntax comparison a translation run uses, so a value that a run would reject cannot be approved in bulk. A single approval still can.
- One plan holds every approval, one review file write and the state writes, and fails as a whole when the files changed since planning.
- Batch approval is a human act. It is not an MCP tool, and the `x18n:approve` RPC is not an agent tool. Agents leave `x18n review approve` single approvals or suggestions, as `x18n prompt review` already asks ([10-agents.md](./10-agents.md)).

### Batch suggestions (planned)

The same query serves `planSuggestionApplies(query)`: apply the open suggestions it matches, for example every suggestion a translation run left on stale values (`machine: 'ai'`). It reuses the skip reasons and adds `no-suggestion`.

## Surfaces

| Surface | Features |
| --- | --- |
| CLI | `x18n review list [key] [--locale] [--open]`, `comment`, `approve`, `request-change --text`, `suggest --value`, `resolve <id>`, `apply-suggestion <id>`, `mark-fresh <key>`. `x18n get` lists the threads. Batch (shipped): `x18n review approve [glob] --locale <l,...> [--namespace] [--machine [translator]] [--state needs-review] [--thread suggested] [--from <file>] [--stale skip\|approve\|mark-fresh] [--override-change-requests] [--text] [--limit] [--dry-run] [--yes] [--json]`. A glob or any filter flag makes it a batch; the bare `approve <key>` stays a single approval. A batch prints what it approves and skips; on a TTY it asks before writing more than 20 approvals unless `--yes`. `--from` reads `{ "de": { "<key>": "<value>" } }` (the shape `x18n apply` takes) as `values`, so a reviewer can approve exactly the file they read. Planned: `x18n review apply-suggestion` with the same flags and no id. |
| LSP | Diagnostic `review-changes-requested` with a quick fix that resolves it; hover shows the open review state per locale; `x18n/reviews` request; `x18n.review`, `x18n.resolveReview`, `x18n.applySuggestion` commands, which write at once. |
| VS Code | Comments API threads on the key in each locale's resource, with reply as comment, approve, request change or suggestion, and resolve and apply buttons; "Review Key" from the cursor or the Keys view; Reviews view. Batch (planned): "Approve Selected" in the Keys and Reviews views (multi-select), and "Approve Machine Translations in Locale" with a confirm that shows the counts, through LSP `x18n/planApprovals` and the `x18n.approve` command. |
| UI | Thread under each locale value on the key page, with a form for new reviews; `/reviews` page filtered by state; filter keys by open reviews and a state icon per cell. Writes go through `x18n:apply`; reads through `x18n:reviews`. Batch (planned): in the keys grid, select cells or rows (checkbox, shift-click, select all in the filter) and "Approve" from the bulk bar; the plan carries the values on screen. `/reviews` gets a **Needs review** queue per locale: machine-translated and `needs-review` messages with source, value, issues, related values and a usage snippet, approved one by one (`a` approve, `e` edit, `s` skip, `j`/`k` move) or all shown at once. The translate panel offers "Apply and approve" for the rows a reviewer accepted. Every batch shows the approved and skipped counts with reasons before it writes. RPC `x18n:plan-approvals` (query) and `x18n:approve` (action, not an agent tool). |
| Agents | `x18n prompt review` asks for `x18n review suggest` and `request-change` commands; MCP tools `x18n_reviews` and `x18n_review`. |
