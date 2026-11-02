import type { ErrorCode } from '../../packages/core/src/index'

/** The title and the "What to do" section of each error page. `generate.ts` fails when a code has no entry. */
export const errorNotes: { readonly [C in ErrorCode]: { readonly title: string, readonly notes: string } } = {
  X18N0001: {
    title: 'Invalid config',
    notes: `The config, or the input of a command, does not match what x18n expects. The message names the field and the problem, for example \`usage.include: Invalid type\`.

1. Read the field path in the message and compare the value with the [config reference](/references/config).
2. YAML and JSON configs reject unknown keys. If the field is a typo, fix the name.
3. Add \`$schema: https://x18n.dev/schema/config.json\` to a YAML or JSON config. Your editor then shows the errors as you type.

The CLI uses the same code for command input it cannot use: an unknown \`--reporter\` id, an unknown \`x18n prompt\` kind, a missing \`--to\`, or an \`x18n.config.*\` that already exists when you run \`x18n init\` or \`x18n migrate\` without \`--force\`.`,
  },

  X18N0002: {
    title: 'Config file could not be loaded',
    notes: `x18n found a config file, but it failed to run or read it. The message holds the error from the loader.

1. Fix the syntax error that the message names.
2. Make sure that a TS or JS config has a default export, for example \`export default defineConfig({ ... })\`.
3. Run \`x18n doctor\` to see which config file x18n picked.`,
  },

  X18N0003: {
    title: 'Unknown project',
    notes: `The command needs one project, but the name you gave matches none, or the workspace has several projects and you gave no name.

1. Run \`x18n status\` to list the project names.
2. Pass one of them with \`--project <name>\`.

Commands that write files (\`set\`, \`apply\`, \`rename\`, \`delete\`, \`fill\`, \`format\`, \`extract\`, \`prompt\`) always need one project in a monorepo.`,
  },

  X18N1001: {
    title: 'Plugin could not be loaded',
    notes: `x18n failed to load a plugin from \`plugins\` or \`presets\`.

1. If the specifier is a package name, install the package in the project.
2. If it is a path, make sure that it is relative to the config file and that the file exists.
3. Make sure that the module exports a plugin, a preset, or a function that returns one.`,
  },

  X18N1002: {
    title: 'Duplicate capability id',
    notes: `Two plugins register a capability (a format, finder, scanner, check, reporter or placeholder syntax) with the same id.

1. Rename the id in your own plugin.
2. If the second one is meant to replace the first, set \`override: true\` on it.`,
  },

  X18N1003: {
    title: 'Unknown preset',
    notes: `A string in \`presets\` is not the name of a built-in preset, and x18n has no plugin loader in this runtime.

1. Use a name from the [presets list](/presets).
2. Or pass a preset object from a TS config, for example \`presets: [vueI18n()]\`.`,
  },

  X18N1004: {
    title: 'Invalid YAML plugin',
    notes: `A YAML plugin file does not match the plugin schema. The message names the file, the field and the problem.

1. Add \`# yaml-language-server: $schema=https://x18n.dev/schema/plugin.json\` as the first line of the file. Your editor then shows the errors.
2. Fix each field that the message lists. See [YAML plugins](/plugins/yaml).`,
  },

  X18N2001: {
    title: 'No format for resource',
    notes: `x18n found a locale file, but no format reads its extension.

1. Map the extension to a format id in the config: \`formats: { lang: 'json' }\`.
2. Or add a plugin that has a format for the extension.

\`x18n check\` reports this as an \`invalid-resource\` diagnostic on the file.`,
  },

  X18N2002: {
    title: 'Resource could not be parsed',
    notes: `A locale file has a syntax error. The message names the file and the position.

1. Open the file and fix the syntax error.
2. Run \`x18n check\` again.

\`x18n check\` reports this as an \`invalid-resource\` diagnostic on the file.`,
  },

  X18N2003: {
    title: 'Resource is not an object of messages',
    notes: `A locale file parsed, but its top level is not an object of messages. A locale file holds nested objects whose leaves are strings, numbers, booleans or \`null\`.

1. Make sure that the top level of the file is an object, not an array or a string.
2. If the file is not a locale file, change \`resources\` so that its pattern does not match the file.`,
  },

  X18N2004: {
    title: 'Locale file is not static',
    notes: `x18n reads JS and TS locale files as text and does not run them. A file that computes its messages cannot be read that way.

1. Move the messages to a JSON or YAML file.
2. Or set \`execute: true\` on the resource pattern. x18n then runs the file in Node, and the messages become read-only.`,
  },

  X18N3001: {
    title: 'Source file could not be scanned',
    notes: `A scanner failed to parse a source file, so x18n did not find the usages in it.

1. Fix the syntax error in the file.
2. If the file is generated or is not source code, exclude it with \`usage.exclude\`.

\`x18n check\` reports this as an \`invalid-resource\` warning on the file.`,
  },

  X18N4001: {
    title: 'Resource is read-only',
    notes: `The edit targets a read-only resource. Resources with \`execute: true\` are read-only, because x18n cannot write the code that computes them.

1. Edit the source of the computed values by hand.
2. Or move the messages to a JSON or YAML file.`,
  },

  X18N4002: {
    title: 'Rename target already exists',
    notes: `A rename target already exists in at least one locale. x18n does not merge two keys.

1. Run \`x18n get <to>\` to see the existing key.
2. Delete or rename it first, then run the rename again.`,
  },

  X18N4003: {
    title: 'A decision is needed',
    notes: `The plan has a decision (a question such as "which file gets the new key"), and the command got no answer. This happens with \`--json\`, or when stdin is not a terminal.

1. Run the command again with \`--yes\` to accept the default answer of each decision.
2. Or run it in a terminal and answer the questions.`,
  },

  X18N4004: {
    title: 'Plan is stale',
    notes: `A file changed after x18n made the plan, so x18n did not write anything. For \`x18n extract --apply\`, the source file changed after you wrote the plan file.

1. Run the command again. x18n makes a new plan from the current files.
2. For extraction, run \`x18n extract --plan <file>\` again and edit the new plan.`,
  },

  X18N4005: {
    title: 'No resource for the key',
    notes: `x18n has no resource where it can write the key in this locale.

1. Add a resource pattern in \`resources\` that covers the locale, for example \`{ pattern: 'locales/{locale}.json' }\`.
2. Or create the locale file, then run the command again.`,
  },

  X18N4006: {
    title: 'Key not found',
    notes: `The key does not exist in any locale.

1. Run \`x18n keys\` to list the keys, or \`x18n keys "<glob>"\` to search.
2. Check the namespace. In a namespaced project the key is \`ns:path\`, for example \`common:save\`.`,
  },

  X18N4007: {
    title: 'Placeholder mismatch',
    notes: `A value adds or drops a placeholder compared to the source value, so \`x18n apply\` wrote nothing. The JSON output lists the values in \`data.rejected\`.

1. Keep every placeholder of the source value, with the same name, for example \`{name}\` or \`{{count}}\`.
2. Run \`x18n apply\` again.
3. If the difference is on purpose, pass \`--force\`.`,
  },

  X18N4008: {
    title: 'Invalid edit input',
    notes: `The input of an edit has the wrong shape.

- \`x18n set\` needs \`--value <text>\` (or \`--value -\` to read stdin).
- \`x18n apply\` needs JSON in the shape \`{ "<locale>": { "<key>": "<value>" } }\`. Values are strings, numbers, booleans or \`null\`.
- \`x18n extract --apply\` needs a plan file written by \`x18n extract --plan\`.
- \`x18n review\` needs \`--locale <locale>\` to comment, approve, request a change or suggest; \`request-change\` needs \`--text\` and \`suggest\` needs \`--value\`.`,
  },

  X18N5001: {
    title: 'Review file could not be read',
    notes: `x18n found the review file (\`review.file\`, default \`.x18n/reviews.yml\`), but it is not valid YAML or does not match the reviews schema. Until it is fixed, x18n does not write reviews, so the file never loses what it holds. Renames and deletes still work, but leave the file as it is.

1. Fix the problem that the message names. A merge conflict in the file is a common cause.
2. Add \`# yaml-language-server: $schema=https://x18n.dev/schema/reviews.json\` as the first line. Your editor then shows the errors.
3. Or restore the file from git.`,
  },

  X18N5003: {
    title: 'Reviews are not available',
    notes: `A review command ran, but the project cannot write reviews. The message says why:

- \`review.enabled\` is \`false\` in the config.
- The review file could not be read (see [X18N5001](/errors/x18n5001)).`,
  },

  X18N5004: {
    title: 'Review not found',
    notes: `No review in the review file has this id.

1. Run \`x18n review list\` to list review ids.
2. If someone else changed the file, pull their changes first.`,
  },

  X18N5005: {
    title: 'Not an open suggestion',
    notes: `\`x18n review apply-suggestion\` applies only reviews of type \`suggestion\` that are not resolved yet.

1. Run \`x18n review list --open\` to list open suggestions.
2. To change the value yourself, use \`x18n set\`.`,
  },
}

/** Extra text on the page of a check. */
export const checkNotes: { readonly [id: string]: string } = {
  'missing-key': `Usages with a dynamic key are not reported. A usage with a static prefix, such as \`\`t(\`pages.\${id}.title\`)\`\`, is a prefix usage: it makes every key under \`pages\` count as used, and it is never a missing key.

The fix adds the key with the default value written in the call (\`t('save', 'Save')\` or \`t('save', { defaultValue: 'Save' })\` with i18next), else with an empty value.`,
  'param-mismatch': `The check compares the params a translate call passes with the placeholders of the source message. For \`"greet": "Hello {{name}}"\`, it reports \`t('greet', { nam })\`: \`name\` is missing and \`nam\` is unused.

It needs a preset that tells where the params of a call are; the i18next presets do. Options the library reads itself, such as i18next \`count\`, \`context\` and \`defaultValue\`, are never unused. Unused params are reported only when the message has placeholders and no nested messages (\`$t(key)\`), which may use them.

The check skips a call whose params it cannot read, such as a variable or a spread (\`t('greet', opts)\`), and a key whose source message is not a string, such as a plural key that only has \`greet_one\` and \`greet_other\`.`,
  'missing-translation': 'The check reports one diagnostic per key, at the entry in the source locale, and lists the locales that lack the key. An empty string is not missing: the `empty-translation` check reports it.',
  'unused-key': `A key counts as used when:

- a usage names it,
- a prefix usage covers it,
- it matches \`usage.keysInUse\`,
- it is a derived key of a used key (\`usage.derivedKeys\`, for example i18next \`{key}_*\` plural keys),
- a linked message or nesting placeholder (\`@:key\`, \`$t(key)\`) names it.

The check runs only when the project has at least one scanner.`,
  'key-style': `The check takes options. Set them with the array form:

\`\`\`ts [x18n.config.ts]
import { defineConfig } from '@x18n/core'

export default defineConfig({
  checks: {
    'key-style': [
      'warning',
      { case: 'camel' }
    ],
  },
})
\`\`\`

- \`case\`: \`camel\`, \`snake\`, \`kebab\` or \`pascal\`. Each segment of the key path must match.
- \`pattern\`: a regular expression that the whole key must match.`,
  'hard-string': 'The check is on when `extract.autoDetect` is `true`, or when you set a severity for it in `checks`. Run `x18n extract` to turn the reported strings into keys.',
  'glossary': 'The check reads the `glossary` config. For each term in a source value, it expects the target value to hold the translation of the term, or the term itself when `doNotTranslate` is `true`.',
  'stale-translation': `A translation is stale when it last changed before its source message did. Inside a git repo, x18n reads the commits that touched the locale files and compares the parsed messages, so reformatting, sorting and moving keys between files do not count. Uncommitted edits count as changed now. A message without history is never stale.

In CI, fetch the full history: a shallow clone (the \`actions/checkout\` default) reports nothing. Set \`fetch-depth: 0\`. Limit the walk with \`history: { git: { maxDepth, since } }\`, or turn history off with \`history: false\`. \`x18n prompt translate --to <locale> --stale\` adds stale translations to the prompt, with the source text from when they last changed.`,
  'review-changes-requested': 'The check reports each message whose open review comments end in a change request, at the message in the reviewed locale. The quick fix resolves the request. A later approval by anyone clears it too. See [Reviews](/guide/reviews).',
  'identical-to-source': `A target value equal to the source value is often an untranslated copy. The check skips:

- locales of the source locale's language (\`en-GB\` and \`en_US\` against \`en\`),
- values with no letters once placeholders, nesting references and tags are removed (\`{{count}}\`, \`100 %\`, \`<0/>\`),
- URLs and e-mail addresses,
- short all-caps words of up to five letters (\`OK\`, \`FAQ\`),
- \`doNotTranslate\` terms of the \`glossary\`, such as brand names.

Words that are the same in both languages, such as "Plugins" in German, are still reported. That is why the check reports at \`info\`, which \`strict\` does not turn into an error. \`ignoreKeys\` removes such keys, from every check.

\`x18n prompt translate --to <locale> --check identical-to-source\` puts the reported values on the translate prompt. See [Translate reported values](/agents/prompts#translate-reported-values).`,
  'dynamic-key': 'A fully dynamic key, such as `t(key)`, has no static prefix. No check can follow it. Turn this check on to find such usages.',
}

/** Checks that have a severity but run only when the config turns them on. */
export const optInChecks: readonly string[] = ['hard-string']

/** `invalid-resource` is not a check: the analysis reports files it could not read with this code. */
export const invalidResource = {
  id: 'invalid-resource',
  description: 'A locale file or source file that x18n failed to read, parse or scan.',
  notes: `The message ends with the error code, for example \`(X18N2002)\`. The [error page](/errors) of that code tells you what to do.

Files that x18n cannot parse as locale files are errors. Source files that a scanner cannot parse are warnings. You cannot turn this diagnostic off in \`checks\`. To skip a source file, exclude it with \`usage.exclude\`.`,
}

/** Descriptions of config fields that have no JSDoc in `types/config.ts`, keyed by `<interface>.<field>`. */
export const configNotes: { readonly [field: string]: string } = {
  'SerializableConfig.$schema': 'URL of the JSON Schema, for validation in the editor. x18n ignores it.',
  'SerializableConfig.sourceLocale': 'The locale that is the source of truth for checks, prompts and go to definition.',
  'SerializableConfig.ignoreLocales': 'Locale codes to leave out, as written in paths.',
  'SerializableConfig.plugins': 'Plugins to add: a package name, a path to a module or to a YAML plugin, or `[specifier, options]`. Paths are relative to the config file.',
  'SerializableConfig.resources': 'Where the locale files are. Each pattern feeds the `pattern` locale finder. Without patterns, the patterns of all applied presets add up. If they match no file, x18n looks for directories named like `locales`.',
  'SerializableConfig.namespace': 'How keys and namespaces relate in code.',
  'SerializableConfig.usage': 'How x18n finds usages in source files.',
  'SerializableConfig.write': 'How x18n writes locale files.',
  'SerializableConfig.extract': 'How `x18n extract` finds hard strings and makes keys.',
  'SerializableConfig.glossary': 'Terms with fixed translations. Translate prompts list them, and the `glossary` check compares values with them.',
  'SerializableConfig.keyStyle': 'Key style of a file that has no keys yet. `flat` writes `"a.b"` keys. `nested` and `auto` write nested objects. A file that already has keys keeps its own style.',
  'ResourceSpec.format': 'Format id for the matching files, for example `json` or `yaml`. Without it, the file extension picks the format.',
  'UsageOptions.include': 'Globs of the source files to scan for usages.',
  'UsageOptions.exclude': 'Globs of the source files to skip. Your list adds to the default list.',
  'UsageOptions.calls': 'Translate calls to add to the ones of the presets. See [Supported syntax](/plugins/yaml#sections-scanners).',
  'UsageOptions.regex': 'Regex scanners for files that no AST scanner reads, such as PHP or Ruby templates.',
  'ArgSource.arg': 'Index of the argument, from 0.',
  'ArgSource.property': 'Property of an object argument that holds the value.',
  'WriteOptions.sort': 'Key order when x18n writes a file. `binary` sorts by code point, `locale` sorts with a locale-aware compare, `false` keeps the order.',
  'WriteOptions.indent': 'Indent of written files: a number of spaces, or `tab`. Without it, each file keeps its own indent.',
  'ExtractOptions.keygen': 'How `x18n extract` makes a new key: `slug` from the text, `source` uses the text itself, `random`, or `empty`. Default `slug`.',
  'ExtractOptions.keyCase': 'Case of slug keys. Default `camel`.',
  'ExtractOptions.keyMaxLength': 'Longest slug, in characters. Default 40.',
  'ExtractOptions.ignoreAttributes': 'Attribute names whose values are never extracted, even text ones such as `alt`.',
  'ExtractOptions.ignoreCallees': 'Accepted by the schema. x18n does not read it yet.',
  'ExtractOptions.templates': 'Replacement templates, tried before the templates of presets. See [Extraction templates](/presets#extraction-templates).',
  'ExtractTemplate.template': 'Replacement code. `{key}` is the key, `{attr}` the attribute name, `{args}` the arguments of a template string.',
  'GlossaryEntry.term': 'The term as written in source values.',
  'GlossaryEntry.note': 'A note for translators. Translate prompts show it.',
  'GlossaryEntry.doNotTranslate': 'Keep the term as it is in every locale.',
  'UserConfig.presets': 'As in YAML, plus preset objects such as `vueI18n()` from `@x18n/builtins/presets/vue-i18n`. `false` and `undefined` entries are skipped.',
  'UserConfig.plugins': 'As in YAML, plus plugin and preset objects, for example from `definePlugin`.',
  'UserConfig.checks': 'As in YAML. Plugins add their check ids to the type, so the editor completes them.',
  'UserConfig.pluginConfigs': 'Options of plugins, under the key that each plugin declares.',
}
