# 02 - Core

`@x18n/core` owns the domain model and every rule about it. It runs in Node, browsers and workers. All I/O goes through a `Host` that the caller passes in. Names follow [glossary.md](./glossary.md).

The code blocks below are design sketches. Final names can change during implementation; the shapes and the rules SHOULD NOT.

## Domain model

```ts
/** The locale code exactly as written in paths and files: `en`, `zh_CN`, `pt-BR`. Never normalized. */
type LocaleCode = string & { readonly __brand: 'LocaleCode' }

/** Display data from a lenient parse of a code. Never changes the code itself. */
interface LocaleInfo {
  readonly code: LocaleCode
  readonly language: string | undefined // 'zh'
  readonly region: string | undefined // 'CN'
  readonly displayName: string | undefined // 'Chinese (China)', via Intl.DisplayNames
  readonly flag: string | undefined
  readonly pluralCategories: readonly Intl.LDMLPluralRule[] // used by prompts and typegen
  readonly requiredPluralCategories: readonly Intl.LDMLPluralRule[] // `other` and what whole numbers select, used by coverage
}

/** Canonical key: optional namespace plus path segments. With `keySeparator: false` the path is one literal segment that may hold `.` and `:`. */
interface KeyId {
  readonly namespace: string | undefined
  readonly path: readonly string[]
}

/** Canonical string form: `ns:a.b.c`, or `a.b.c` without namespace. The namespace ends at the first `:`; the path is joined by `keySeparator` (`.`, or kept whole when `false`). */
type KeyString = string & { readonly __brand: 'KeyString' }

type MessageLeaf = string | number | boolean | null

/** One stored value of one key in one locale. */
interface Message {
  readonly key: KeyString
  readonly locale: LocaleCode
  readonly value: MessageLeaf
  readonly resource: ResourceId
  /** Ranges of the key and the value in the resource text, when the format can report them. */
  readonly range: { key: TextRange, value: TextRange } | undefined
}

/** One file (or one block inside a file) that holds messages for one locale and one namespace. */
interface Resource {
  readonly id: ResourceId
  readonly path: string // posix path relative to project root
  readonly locale: LocaleCode
  readonly namespace: string | undefined
  readonly format: string // format id, for example 'json'
  readonly block: ResourceBlock | undefined // set for embedded resources such as a Vue <i18n> block
  /** True for read-only formats and for resources loaded with `execute: true`. */
  readonly readonly: boolean
}

interface Usage {
  readonly key: KeyString | undefined // undefined when the key is fully dynamic
  readonly raw: string // the key text as written in code
  readonly path: string
  /** Range of the key text only (inside the quotes), the range rename rewrites. */
  readonly range: TextRange
  readonly scanner: string // scanner id
  /** How the key was found: a call argument, a selector (`$ => $.a.b`), an accessor (`m.a_b()`), a same-file constant, or a `@x18n-key` marker. */
  readonly kind: 'call' | 'selector' | 'accessor' | 'constant' | 'marker'
  /** `t(`pages.${id}.title`)` gives 'prefix' with key `pages`. Prefix usages are "possible" references of every key under the prefix. */
  readonly dynamic: false | 'prefix' | 'unknown'
  readonly locale: LocaleCode | undefined // when the call pins a locale
}

interface TextRange { readonly start: number, readonly end: number } // UTF-16 offsets
```

Rules:

- Keys are compared by `KeyString` only. Plugins turn raw text into keys with `normalizeKey` hooks, never by string tricks in surfaces.
- Locale codes are used exactly as found. `zh_CN` and `zh-CN` are two locales; the `locale-code-conflict` check warns about such near-duplicates. Display data comes from `localeInfo(code)`: a lenient built-in parse, which plugins can replace for odd schemes.
- Offsets are UTF-16 code units, the same as JS strings. The LSP converts to line and character.
- Messages keep non-string leaves as found, so a write does not turn `3` into `"3"`.

## Host

```ts
interface Host {
  readonly root: string
  readFile: (path: string) => Promise<string | undefined>
  writeFile: (path: string, content: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  /** Returns posix paths relative to root. Must honour `ignore` and the project's gitignore when `gitignore` is true. */
  glob: (patterns: readonly string[], options: GlobOptions) => Promise<string[]>
  watch?: (patterns: readonly string[], onChange: (events: readonly FileEvent[]) => void) => Disposable
  /** Persistent key-value cache. Optional; without it, every run is cold. */
  cache?: CacheStore
  /** Identity for reviews. Node host reads git config. */
  identity?: () => Promise<Identity | undefined>
  logger: Logger
}
```

Implementations:

| Host | Package | Notes |
| --- | --- | --- |
| `createMemoryHost(files)` | `@x18n/core` | For tests, the demo playground and agents that pass in-memory content. |
| `createNodeHost(root)` | `@x18n/node` | `node:fs/promises`, tinyglobby, chokidar, cache in `node_modules/.cache/x18n`. |
| `createOverlayHost(base)` | `@x18n/core` | Wraps another host. Open editor buffers shadow disk content. Used by the LSP. |
| `createBrowserHost(dirHandle)` | `@x18n/ui` | File System Access API; falls back to a memory host. |

## Project engine

```ts
const project = await createProject({ host, config }) // config is the resolved config, see 04-config.md
await project.ready // discovery + parse + index

project.locales // LocaleCode[] in display order
project.sourceLocale
project.resources // Resource[]
project.keys() // KeyString[]; filters by namespace, prefix, glob
project.get(key) // KeyInfo: messages per locale, usages, diagnostics, review threads
project.message(key, locale)
project.usages({ key, path }) // both filters optional; with `key`, prefix usages come back marked `possible`
project.keyAt(path, offset) // the key (or resource node) under a position: the base of definition, references and rename
project.analyze() // Analysis: diagnostics, coverage per locale, unused, missing
project.events.on('change', (change: ProjectChange) => {})
project.dispose()
```

Lifecycle:

1. **Resolve.** Config is resolved and the plugin list is final ([04-config.md](./04-config.md)).
2. **Detect.** Presets with `detect` run against the package manifests the host can read (`package.json`, `composer.json`, `pubspec.yaml`, `Gemfile`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`). Parsing of manifests is a plugin concern too (`manifests` contribution).
3. **Discover.** Every locale finder returns `ResourceCandidate[]`. Core merges them, drops duplicates (first finder wins, recorded in `project.explain()`), and picks a format per resource by finder hint, then by extension.
4. **Parse.** Each resource is parsed by its format into a `MessageTree`, then passes through `transformResource` hooks (for example Rails strips the top-level locale key).
5. **Index.** The key index maps `KeyString` to messages per locale. Namespaces come from the finder (path pattern) and are added to the key.
6. **Scan.** Scanners run over the usage file set (config `usage.include` / `exclude`, gitignore aware). Results go into the usage index, per file.
7. **Analyze.** Checks run over indexes and produce diagnostics.
8. **Watch.** When the host can watch, a file change invalidates only the affected resource or source file and re-runs the needed steps. Change events say what changed, so the LSP and UI refresh only that part.

Incremental rules:

- Each index entry stores a content hash. A parse or scan is skipped when the hash matches, which also makes the persistent cache work across runs.
- Analysis is lazy and memoized per revision. `project.revision` goes up on every change.
- Scanning runs in-process; the budgets pass without worker threads ([D30](./decisions.md#d30---no-worker-threads-in-10)).

### `project.explain()`

Returns how the project was understood: detected presets and why, each finder and what it found, which format read each file, which scanner handles which extension, the resolved config with the origin of each value (default, preset, user). The CLI prints it with `x18n doctor` through `renderExplanation`, the language server returns the same text from `x18n/explain`, and the UI shows it on the "Project" page. This is the main tool for plugin authors.

## Edits

Every write goes through one planner, so the CLI, LSP, UI and agents get the same behaviour.

```ts
const plan = project.plan([
  { type: 'set', key, locale, value },
  { type: 'rename', from, to }, // one key; may change namespace and nesting
  { type: 'rename-prefix', from, to }, // every key under `from.`, used for parent nodes and `x18n rename pages screens`
  { type: 'delete', key, locales: 'all' },
  { type: 'extract', items }, // see 11-extraction.md
])

plan.changes // FileChange[]: text edits per file, or create / delete
plan.decisions // Decision[]: questions that need an answer, for example which file gets a new key
plan.warnings
const applied = await project.apply(plan, { answers }) // host writes; returns new revision
```

```ts
type FileChange
  = | { type: 'edit', path: string, edits: readonly TextEdit[] }
    | { type: 'create', path: string, content: string }
    | { type: 'delete', path: string }

interface TextEdit { readonly range: TextRange, readonly text: string }
```

Rules:

- Planning has no side effects. `plan` can run as a dry run, and the LSP turns `changes` into a `WorkspaceEdit` without writing anything.
- Formats SHOULD edit in place (keep comments, order, quotes and indentation). A format that can only serialize returns a full-file edit. The plan marks this in `warnings` so a surface can tell the user that formatting was reset.
- New keys go into (1) the resource of the key's namespace, else (2) the resource that holds the most keys sharing the longest prefix with the new key, else (3) the first resource of the locale. Only a tie returns a decision; CLI flags and agent input can answer upfront. New keys follow the nesting style of the target file.
- Rename rules:
  - The result is the same whether the rename starts from a usage or from a key in any locale's resource.
  - One plan covers every locale, every usage, the static part of dynamic prefix usages, and review threads.
  - A rename may change nesting (`a.b` to `c.d.e`). Parent objects left empty are removed.
  - A rename that changes the namespace (`common:save` to `actions:save`) moves entries between resources in every locale. It creates missing target resources through the finder's `resolveNew`. It updates scoped usages (`useTranslation('common')`) only when no other key in the same scope would change; otherwise it warns.
  - A rename is refused, listing the conflicting files, when the target key already exists in any locale.
  - Renaming a key covered by a dynamic prefix usage goes ahead with a warning that lists the usages it cannot update.
- Bulk delete of unused keys (`Project.planUnused(query?)`) returns an `UnusedDeletion`: the plan (delete ops in every locale, through the in-place path), the keys with their locale and file per message, and the kept keys. It starts from `analyze().unused`, the list behind the `unused-key` check, so static, prefix and derived usages, `keysInUse` and references already count. It then leaves out `ignoreKeys`, and keys a fully dynamic usage (`t(name)`) may reach through its scope: the scope namespace and the scope key prefix (`keyPrefix`). A fully dynamic usage without a scope may reach any key; it adds a plan warning instead of blocking every delete. The `unused-key` check itself still ignores fully dynamic usages.
- Writes to read-only resources (read-only formats, `execute: true` resources) fail with a coded error naming the resource.
- A plan is checked against the current revision. If files changed between plan and apply, apply fails with a coded error and the caller plans again.
- `keepFilled` (i18n-ally `keepFulfilled`) is a config switch. When it is on, `set` in one locale also adds the key with an empty value to the other locales.

## Checks and diagnostics

```ts
interface Diagnostic {
  readonly code: string // check id, for example 'missing-translation'
  readonly severity: 'error' | 'warning' | 'info' | 'hint'
  readonly message: string
  readonly key: KeyString | undefined
  readonly locale: LocaleCode | undefined
  readonly location: { path: string, range: TextRange } | undefined
  readonly fixes: readonly Fix[] // each fix is a list of edit operations for the planner
}
```

Checks are plugins ([03-plugins.md](./03-plugins.md)), so core holds only the runner, severities, the `recommended` defaults, `strict` mode (warnings become errors) and suppression. Suppression works by config (`checks: { 'unused-key': 'off' }`), by key glob (`keysInUse`, `ignoreKeys`), and by inline comments in source files (`// x18n-disable-next-line`, `/* x18n-disable */`), handled by scanners.

`x18n check`, the LSP and the UI all read diagnostics from `project.analyze()` with the same config. The editor shows exactly what `x18n check` reports, the same way TS shows the errors `tsc` reports.

## Translation prompt builder

Core builds prompts from the analysis, because the content depends only on project state. The surfaces only print or send them. Details in [10-agents.md](./10-agents.md).

## Errors

Core errors are coded (`X18N` + 4 digits) with a reason (`why`), a `fix` and a docs link, so the CLI can print them well and JSON output can carry the code. They are a [nostics](https://nostics.dev) catalog (`errors` in `errors.ts`): each code has typed params, and a call site raises it with `throw errors.X18N2002({ path, reason })`. Core defines no reporters; surfaces print what they catch. They are grouped: `X18N0xxx` config, `1xxx` plugin, `2xxx` discovery and parse, `3xxx` scanning, `4xxx` edits, `5xxx` reviews. Each code gets a docs page under `docs/content/errors/` ([16-docs.md](./16-docs.md)).
