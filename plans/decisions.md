# Decisions

Each entry: what was decided, what else was considered, and why. New decisions go at the end.

## D1 - Scoped package layout

`@x18n/core`, `@x18n/builtins`, `@x18n/node`, `x18n` (CLI), `@x18n/lsp`, `@x18n/ui`, `x18n-vscode`.

- Considered: one package per plugin (`@x18n/plugin-*`), or few packages (`x18n` with everything).
- Why: layer boundaries are package boundaries, which keeps core free of Node and editor code. One `builtins` package with subpaths keeps installs simple while staying tree-shakable.

## D2 - Core takes an injected host and runs in the browser

- Considered: Node-only core.
- Why: the in-browser workspace, the LSP overlay of unsaved buffers, and memory-host tests all need the same seam.

## D3 - Config in TS, YAML or JSON, validated by valibot

- Considered: zod 4, hand-written JSON Schema.
- Why: one schema for runtime validation, JSON Schema for editors and the serializable TS types. valibot is small and tree-shakable, which matters for the browser bundle.

## D4 - AST-first scanners, regex kept

- Considered: regex only (i18n-ally parity), AST only.
- Why: AST scanning handles aliases, scopes, constants, selectors and multi-line calls. Regex stays for i18n-ally parity, languages without an AST scanner, and YAML plugins. Both are scanners; neither is special in core.

## D5 - Unified plugin object plus presets

- Considered: separate registries per capability; frameworks as their own concept.
- Why: one plugin often needs several capabilities that must agree (a library's scanner, key normalization and placeholder syntax). A preset is just a detected list of plugins, so "framework" needs no special concept.

## D6 - UI on Nuxt (SPA mode)

- Considered: plain Vue + Vite SPA.
- Why: matches node-modules-inspector and eslint-config-inspector, which already ship devframe UIs with Nuxt static output and relative base. File routing and modules (UnoCSS, VueUse) come for free.

## D7 - The LSP hosts the UI server; VS Code iframes it

- Considered: a second server in the extension host; a postMessage RPC bridge.
- Why: one `Project` per process keeps the editor and UI in sync without reloads. devframe has no postMessage transport in its public API. `asExternalUri` makes it work in remote setups.

## D8 - Deployed site: static report in 1.0, in-browser workspace in 1.x

- Considered: static report only; both in 1.0.
- Why: the static report covers CI and translators. The in-browser workspace lets people try x18n with no install, and is cheap once D2 holds, but it is not needed for 1.0 (D17).

## D9 - No machine translation engines; translate prompts instead

> Superseded by D46.

- Considered: porting i18n-ally translators.
- Why: agents and LLMs already translate well with context. x18n's value is the context (usages, glossary, placeholders, style examples) and safe write-back (`x18n apply` with checks). It also removes API keys from the tool.

## D10 - Reviews in `.x18n/reviews.yml` (1.x)

- Considered: no built-in store; comments inside locale files.
- Why: git-tracked, format-independent, and reviewable in PRs. The store is pluggable for other backends.

## D11 - Strict TypeScript

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `isolatedDeclarations` for libraries.

- Why: the plugin API is the product for plugin authors. Strict options catch the optional and index bugs that i18n-ally's `object`-typed data allowed.

## D12 - Turborepo for tasks

- Considered: `pnpm -r`.
- Why: caching of builds and typechecks across 8 workspaces, and `dependsOn` for the UI build that the CLI and extension need. Same setup as devframe and vite-devtools.

## D13 - Docs on comark-docs

- Why: same stack as devframe docs, with `llms.txt` generation for agents.

## D14 - Node >= 22, VS Code ^1.100

- Why: ESM-only packages, `fs.glob`-era Node APIs, current LSP client features.

## D15 - Locale files are static by default; execution is an explicit opt-in

- Considered: never execute; a global switch.
- Decided: `resources: [{ pattern, execute: true }]`, Node only, executed resources read-only.
- Why: i18n-ally ran JS/TS locale files through ts-node, which runs user code with no clear consent. Static reading covers the common `export default { ... }` case. Computed locale files still exist, so they get a scoped, visible escape hatch.

## D16 - Keys behave like imported symbols

- In code the whole key is the symbol. In resource files the node under the cursor is the symbol, so renaming a parent renames its subtree; flat keys are whole keys.
- Definition goes to the source locale; implementation lists all locales; references work from both sides and include "possible" prefix usages.
- Rename covers all locales, usages, dynamic prefixes and review threads. It can re-nest and move namespaces, and refuses on conflict.
- References and rename wait for a full workspace index.
- Considered: segment-level symbols in code (rejected as surprising for the rename box), partial results while indexing.
- Why: the user asked for `t('xxx.yyy')` to be as reliable as a TS import.

## D17 - 1.0 scope

1.0 includes:
- core, CLI (check, read/write, prompts, MCP, skill), LSP and VS Code
- UI (dev, static, VS Code panel)
- extraction, i18n-ally migration, tier 1 presets and formats, performance budgets

1.x adds reviews, typegen, the in-browser workspace, tier 2 and 3, and other editors. The LSP milestone moves right after edits (M5).

- Why: the editor experience and `x18n check` are the core value. The rest builds on the same engine without changing it.

## D18 - Name-based usage detection

- Decided: a call counts when its callee name is in the callee set. That set is declared names, plus same-file aliases, declared wrappers, and params typed with configured types. There is no per-file gate; opt-outs handle false positives.
- Considered: binding-resolved detection with scope analysis (fewer false positives, misses `t` that arrives through untyped paths).
- Why: same behaviour as i18n-ally, which users rely on. It is simpler and works for injected or global translate functions.

## D19 - TypeScript coexistence without a tsserver plugin

- Decided:
  - provider ordering against TS 6 tsserver
  - TS 7 `registerLspMiddleware` asking the x18n LSP per request
  - deduplicated references in the client
- Considered: a thin tsserver plugin that yields rename, with a sync bridge to ask the LSP; a full tsserver plugin.
- Why: TS 7 never loads tsserver plugins, and a sync bridge blocks tsserver's only thread. Research is summarized in [08-vscode.md](./08-vscode.md).

## D20 - `x18n check` is the typecheck of i18n

- tsc-style output, `--watch`. Read-only unless `--fix` is passed: `--fix` applies the fixes marked `safe`, `--fix=unsafe` also the ones marked `unsafe`; fixes without a level stay editor code actions.
- Considered: no `--fix` at all, with one command per fix (`fill --from-usages`, `delete --unused`, `sync`); one flat `--fix` like ESLint's.
- Why `--fix`: fixes are already ops on the diagnostics, so one generic flag covers every check, plugin checks included, and `--only` picks which. Why levels, as in Biome: a fix that only adds is safe in hooks and CI, a fix that deletes (unused keys, translations) loses data, so it takes an explicit opt-in.
- `recommended` set: invalid keys and broken messages are errors; untranslated and unused keys are warnings. `strict` turns warnings into errors.
- Untranslated keys are reported once per key, at the source entry.
- The editor shows exactly the same diagnostics.
- Why: one mental model, the same as `tsc` and the TS errors in an editor.

## D21 - `x18n.config.ts` is primary; no editor overrides

- TS config first. YAML and JSON stay supported for non-JS projects and the browser.
- `projects` globs with inheritance for monorepos.
- VS Code settings are editor UX only.
- Considered: an `x18n.config` override object in VS Code settings (rejected: CLI and editor would disagree).

## D22 - Locale codes as found

- Codes are never normalized. Near-duplicates get a warning. Display data comes from a lenient parse or a `localeInfo` hook.
- Considered: BCP 47 normalization (i18n-ally default).
- Why: what is in the files is what the user sees and what x18n writes.

## D23 - Editor UX defaults

- In-place annotations are on by default and reveal the key on the cursor line.
- Four sidebar views.
- Extracted keys are bare slugs.
- Why: i18n-ally parity for the habits its users already have.

## D24 - Identity and access

- Extension id `antfu.x18n`, through a staged packaging copy, because Turborepo needs unique workspace names.
- Docs at `x18n.dev`.
- One lockstep version for all packages and the extension.
- `x18n ui` auth always on: magic link, issued tokens, bearer token for HTTP MCP, `--no-auth` for CI only.
- The UI SPA ships inside `@x18n/ui`.

## D25 - Typegen design (1.x)

- x18n builds the types from the merged source-locale view, and presets emit them as library augmentations.
- Params are typed where the library allows.
- One committed `x18n.d.ts`, opt-in, TS projects only.
- It runs from the CLI and the LSP, guarded by the `typegen-stale` check. See [18-typegen.md](./18-typegen.md).

## D26 - Domain names are plain string aliases

- Decided: `LocaleCode`, `KeyString` and `ResourceId` are `string` aliases, not branded types.
- Considered: branded strings as sketched in [02-core.md](./02-core.md).
- Why: brands force a cast at every boundary (CLI input, JSON, LSP). Keys are compared by string, and `project.parseKey` turns user input into the canonical form.

## D27 - Namespaces: merged prefix by default, `ns:key` with a separator

- Decided: with the default `namespace.separator` `.`, a path namespace (`locales/en/pages/home.json`) becomes a key prefix (`pages.home.title`), as i18n-ally did. A preset or config that sets another separator (i18next `:`) keeps namespaces apart (`common:save`); keys without one get `namespace.default`. A key written with an explicit namespace ignores the scope's `keyPrefix`.
- Why: vue-i18n style projects never write namespaces in code; i18next style projects always do.

## D28 - Config and plugins load through jiti

- Decided: `@x18n/node` finds the config file itself and imports TS and JS with jiti; YAML and JSON are parsed directly.
- Considered: unconfig.
- Why: the lookup is a list of six names; jiti is the loader unconfig would use anyway, and the same loader imports TS plugins.

## D29 - Every scanner that claims an extension runs

- Decided: unlike formats (first claim wins), all scanners for an extension run and their usages are merged by range.
- Why: a YAML plugin's `scanners.regex` for `.ts` files must add to the `js` scanner, not lose to it.

## D30 - No worker threads in 1.0

- Decided: scanning stays in-process; the persistent cache, an incremental usage index and memoized analysis meet the budgets.
- Measured on the benchmark fixture (`pnpm bench`): `x18n check` cold 3.1 s, warm 1.4 s, LSP re-scan and diagnostics 16 ms, memory 252 MB.
- Why: the budgets of [15-quality.md](./15-quality.md) pass without them, and the scan seam would be code nobody uses.
- Re-checked for TASK-59 with a working pool: an optional `ScanExecutor` in
  `createProject`, a `module` specifier on scanner entries so a thread can import the scanner, and `node:worker_threads` in
  `@x18n/node`, with threads for one batch only. Results matched in-process scanning exactly. Workers still lose:
  - A CPU profile of a cold `x18n check` puts scanning (Vue SFC and oxc parse and walk) at under a fifth of the run.
    Module loading costs about as much (`yaml` loaded eagerly, `@vue/compiler-sfc` with postcss), then file I/O and GC.
  - Scan phase alone, 5,000 files, median of 8 runs (wall / CPU over all threads): in-process 2.6 s / 2.8 s,
    2 threads 3.5 s / 5.5 s, 4 threads 3.6 s / 8.8 s, 6 threads 3.0 s / 10.6 s. Each thread loads the parsers and
    warms its JIT again, so CPU grows with every thread.
  - Cold `loadWorkspace` without cache, median of 6: in-process 9.1 s, 2 threads 15.8 s, 4 threads 11.7 s.
  - Best case, threads that already loaded the parsers: 1.0 s against 1.4 s in-process. That saves about 0.4 s on the
    first run only. Warm runs read the cache, and an LSP re-scan is one file, so neither gains anything.
  - The runs were on a shared 10-core machine (load average 13 to 23), so treat the wall times as relative. CPU time is less
    affected by load, and it alone rules out a large gain.
- Revisit when a fixture's in-process scan phase is several seconds after caching, or when threads can load the parsers
  while discovery runs. Cheaper first: load `yaml` and other heavy modules only when used.

## D31 - MCP through devframe agent tools; MCP prompts later

- Decided: tools are registered with devframe's agent API under the names of [10-agents.md](./10-agents.md). The `translate`, `review` and `extract` MCP prompts wait for devframe prompt support; agents use the `x18n_translate_prompt` tool meanwhile.
- `x18n/openUi` returns devframe's one-time code as the token; clients open `url#devframe_otp=<token>` (plus `&route=/keys/<key>` for the key editor).

## D32 - `execute: true` ships with the JS/TS format

- Decided: in 1.0, `execute: true` marks matching resources read-only. Running JS/TS locale files arrives with the tier 2 `js`/`ts` format (M15), which also reads static `export default { ... }` files.
- Why: there is no tier 1 format for JS/TS locale files to execute through.
- Update (#136): matching files now run through `Host.executeModule`, which the Node host implements with the config loader (jiti). Core calls it, unwraps a loader export (`(locale) => messages`, sync or async), and reports a throw as `X18N2005`. A host without `executeModule` reads the files statically.

## D33 - Renames edit key text in place

- Decided: formats get only `set` and `delete` ops. When a rename changes only the last segment of a key in the same file, the planner replaces the key text in place, which keeps the entry's position, comments and layout; other renames become delete plus set.
- Why: in-place key edits are format independent for plain segments, so formats stay small.

## D34 - Every i18n-ally framework is a built-in preset

- Decided: the presets cover every framework i18n-ally supports, detected the same way (`package.json`, `composer.json`, `pubspec.yaml`, `Gemfile`; `manifest.json` with `default_locale` for Chrome extensions). `php-gettext` applies only when listed, as in i18n-ally. JS libraries use call specs for the AST scanners; other languages (PHP, Ruby, Dart, Handlebars, Liquid, XML) use i18n-ally's regexes. The po, properties, ftl, ini, php and static JS/TS formats ship with them.
- Resource defaults of detected presets add up; a user `resources` replaces them; when they match no file, x18n guesses locale directories as without a config.
- `react-i18next` is no longer exclusive: shared plugins apply once by name. `laravel` stays exclusive (i18n-ally `monopoly`).
- Why: users moving from i18n-ally expect their stack to work without a config. This pulls part of M15 into 1.0; tier 2 items i18n-ally never had (paraglide, typesafe-i18n, ARB, XLIFF and the other XML formats) stay in M15.

## D35 - Without a config, i18n-ally settings are the defaults

- Decided: when a project has no x18n config, x18n reads its i18n-ally settings (`.vscode/settings.json`, `*.code-workspace`, the custom framework file), with the same mapping as `x18n migrate i18n-ally`, and applies them as a plugin. They work like preset defaults: detection fills what they leave out, and stale locale paths fall back to the locale guess. Patterns that the user did not write only match locale-like names.
- Considered: requiring `x18n migrate i18n-ally` first.
- Why: an i18n-ally project should work in the CLI, CI and editor the moment x18n is installed. The real-world tests (furifont, pulls.review, elk) are all i18n-ally projects; one has stale paths.

## D36 - Namespaces from folders follow the library

- Decided: `namespace.fromPath` names a namespace taken from `{namespaces}` folders. `dot` (default) gives `pages.home`, `slash` keeps `pages/home` (i18next, so `useTranslation('pages/home')` matches), `camel` gives `todosPage` for `todos-page` (Transloco scopes). Presets set it; usages are not rewritten.
- A `camel` namespace cannot give back its folder, so a new locale file copies the path of a sibling resource. A Transloco alias is a resource with a fixed `namespace`.
- Why: i18n-ally-next fixed these cases by rewriting keys in each framework; naming the resource once keeps one canonical key for usages, edits and renames.

## D37 - Stale translations compare per target message

- Decided: a target message is stale when it last changed before its source message, per key and locale. History providers report the times (D38). Review records of the source hash at each x18n write mark a target fresh while the source keeps that value, whatever the providers say (D41). Messages without history are never stale.
- Why: i18n-ally-next keeps one source snapshot per key, so one source edit marks all locales stale until someone refreshes it. Per-target times stay right when locales are updated at different times.

## D38 - History providers report times, core decides staleness

- Decided: the `histories` capability returns when each message last changed (`updatedAt`, revision, author, value). Core applies one stale rule for every provider; the first provider with an entry for a message wins. The git provider lives in `@x18n/node`, is on inside a git repo, compares parsed messages per commit (not line blame), and treats a shallow clone as no history.
- Considered: line blame of the message range; providers that return stale or fresh verdicts; only hash records written by x18n.
- Why: hash records report nothing until values are written through x18n, while git history exists on day one. Parsed messages ignore reformatting, sorting and moves that break blame. Times from any source (meta file, translation service) fit one rule.

## D39 - The editor's agent translates, not an editor LLM engine

> Amended by D46: "Translate with Agent" stays, and the editor's model can also serve as a client translator.

- Decided: "Translate with Agent" in VS Code opens the editor's chat in agent mode with the translate prompt. The agent writes results with `x18n apply` and runs `x18n check`, as the prompt says. Without a chat command, the prompt goes to the clipboard.
- Considered: an editor LLM engine like [i18n-ally-next](https://github.com/Lydanne/i18n-ally-next)'s `editor-llm`: call `vscode.lm`, parse a JSON reply, write it through a new LSP command, with a model setting and picker.
- Why: it keeps D9, as x18n calls no model, and it adds no wire contract or reply parsing. The agent already gets placeholder checks from `x18n apply` and can fix what `x18n check` reports, which a single model reply cannot.

## D40 - One devtools package, with a subpath per host

- Decided: `@x18n/devtools` ships `/vite` (a Vite plugin through `createPluginFromDevframe`, for Vite DevTools and Nuxt DevTools 4) and `/devframe` (a definition for any hub). Both load the workspace from the host's root when the host sets the devframe up, through a loader that `createX18nDevframe` in `@x18n/ui` accepts.
- Considered: a `@x18n/vite` package with only the plugin; a Nuxt module that adds the plugin.
- Why: Nuxt DevTools 4 runs on Vite DevTools, so one plugin covers both, and `vite.plugins` is one line. Hubs need only the definition. Loading in `setup` uses the host's root, so the user passes no path.

## D41 - Reviews: one file, plans write it, staleness is derived

- Decided: the review store only parses and serializes the review file (`review.file`); core reads it, keeps the threads and records, and puts every review write into the edit plan as a file change, so a suggestion applied and resolved is one plan. An approval stores the value it approved, and is stale when the message has another value; nothing writes `stale: true`. Source records are written only once the project has a review file, and only make targets fresh: a record is not a history provider, because it has no time. The last registered store is the active one.
- Considered: an async store API (`list`, `plan`) for remote backends; a `review.store` option to pick among stores; marking approvals stale in the plan that changes the value; writing records on every write.
- Why: the planner is synchronous, and one file keeps the stale-plan check of every other write. A derived stale flag also sees hand edits and pulls. Writing records unasked would add `.x18n/reviews.yml` to projects that never use reviews.

## D42 - Prompt context: descriptions as data, related locales by language

- Decided: formats return message descriptions from `parse` (`descriptions`, keyed by stored path), transforms from `describe`, and call specs name the property beside the key (`description`); core puts them on `Message` and `Usage` and the prompt shows one per item. Related locales are the fallback chain, then the same-language locales by shared subtags; at most two values per item, cut at 300 characters. `related` in prompt options (and `--related`, `--no-related`) overrides the choice.
- Considered: a format-specific description reader in core; a `prompt.relatedLocales` config key; showing every locale's value.
- Why: core stays format-neutral, and descriptions follow the same stored-path keys as ranges. Fallbacks already encode which locales are close; same-language siblings cover the rest without config. A per-run option is enough for now, and two values keep the prompt small when a project has many regional variants.

## D43 - Locale finders can give a key a file of its own

- Decided: `LocaleFinder.resolveKey({ key, locale })` returns the file of one key. Placement asks it before any other rule, so a store with one file per message gets a new file for a new message rather than a second key in another message's file. A rename moves each message to the file of the new key. A delete that empties the file of its key deletes the file; other files stay when their last key goes. `keepFilled` goes through the same placement, so its empty values get files too. `resolveNew` keeps its shape: it places files that hold many keys.
- Considered: passing the key to `resolveNew`, which runs only when no resource fits the key, and in such a store every resource fits a flat key; a placement hook on the format, which knows the file shape but not the layout of the store.
- Why: the finder already owns where files go and has to find the new file again. One optional hook leaves every other layout as it is.

## D44 - `usage.gitignore` turns off gitignore for usage scanning

- Decided: a boolean `usage.gitignore`, default `true`. With `false`, the usage file set is `usage.include` minus `usage.exclude`, whose defaults already skip `node_modules`, `.git` and build output.
- Considered: honouring `.gitignore` except under the static base of each `usage.include` glob.
- Why: a translations repository often scans a git-ignored clone of the sources it translates. One switch is visible in the config and in `x18n doctor`; a rule that depends on how a glob is written would change what existing configs scan, and is hard to predict.

## D46 - Translators as a capability; core owns the pipeline

- Decided: plugins contribute `translators`, which turn a batch into target values and nothing more. Core selects items (the translate prompt's selection), masks placeholders, batches, calls, verifies every candidate with message checks, retries once with the problems, falls through the chain, and returns a `Plan`. Missing messages get values marked `needs-review` with provenance in the review file; existing values get review suggestions unless `overwrite`. Config refers to secrets, the host resolves them. An editor can serve its model as a client translator over the LSP ([20-translation.md](./20-translation.md)).
- Considered: keeping D9 and translating only through agents; porting i18n-ally's engines with one settings block each; one LLM-only `@x18n/mt` package outside the plugin system; a client-side `vscode.lm` engine that writes through a new command (D39).
- Also decided: provenance of machine values lives in the review file, which a run creates when missing. The LLM translator is its own package, `@x18n/translator-ai`, so `@x18n/builtins` carries no AI SDK dependency. No translation memory and no pseudo translator ship: reusing other keys' translations is wrong for short ambiguous strings, so they go to the translator as hints, and tests use fake translators.
- Why: agents need a running agent, and CI, the UI and bulk runs of DeepL-class services do not have one. The value D9 protected (context, placeholder safety, checked write-back) now sits in core, where every translator gets it, instead of in the prompt alone. A capability keeps services out of core and lets third parties add them. Id-matched replies and core-side checks remove the reply parsing and the unchecked writes that D39 rejected.

## D47 - Machine values land as `needs-review`; reviewers approve in batches

- Decided: a translation run writes missing values with `state: 'needs-review'` and provenance (D46). `project.planApprovals(query)` approves many messages in one plan: every approval stores its value, which clears the machine flag; once formats write states, it also sets `reviewed` where the format records state. A batch MUST be narrowed by a filter, a glob or the exact values the reviewer saw; it skips values that changed, fail blocking checks, are stale, or have an open change request, and says why. Batch approval is not an agent tool.
- Considered: review suggestions for every machine value; an `approve-all` without filters; letting agents approve through MCP.
- Why: suggestions leave missing messages empty until someone clicks each one, so the app ships the source text meanwhile; a marked value is useful at once and stays visibly unreviewed. Bulk approval is only safe when it approves what a person saw, so surfaces pass the values on screen. An agent approving machine output would turn review into a rubber stamp.

