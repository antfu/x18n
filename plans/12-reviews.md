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

## Surfaces

| Surface | Features |
| --- | --- |
| CLI | `x18n review list [key] [--locale] [--open]`, `comment`, `approve`, `request-change --text`, `suggest --value`, `resolve <id>`, `apply-suggestion <id>`, `mark-fresh <key>`. `x18n get` lists the threads. |
| LSP | Diagnostic `review-changes-requested` with a quick fix that resolves it; hover shows the open review state per locale; `x18n/reviews` request; `x18n.review`, `x18n.resolveReview`, `x18n.applySuggestion` commands, which write at once. |
| VS Code | Comments API threads on the key in each locale's resource, with reply as comment, approve, request change or suggestion, and resolve and apply buttons; "Review Key" from the cursor or the Keys view; Reviews view. |
| UI | Thread under each locale value on the key page, with a form for new reviews; `/reviews` page filtered by state; filter keys by open reviews and a state icon per cell. Writes go through `x18n:apply`; reads through `x18n:reviews`. |
| Agents | `x18n prompt review` asks for `x18n review suggest` and `request-change` commands; MCP tools `x18n_reviews` and `x18n_review`. |
