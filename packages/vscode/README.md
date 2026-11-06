# x18n for VS Code

Manage and view the i18n files of any project: inline translations, missing-key diagnostics, key rename, hard-string extraction, and the x18n UI in a panel.

See the [documentation](https://x18n.dev/surfaces/vscode) for setup and usage.

## Features

All i18n logic lives in the bundled x18n language server; the extension only presents it.

- **In-place annotations** (on by default): keys in code show their display-locale value. The cursor line and selections show the raw key, and missing keys show in a warning color. With in-place off, values show as hints after the key.
- **Keys as symbols**: go to definition, implementation, references and rename work across code and every locale file, next to TypeScript's own results.
- Hover with every locale's value, completion of keys, diagnostics equal to `x18n check`, and quick fixes to add, fill or extract.
- **Activity bar views**: Current File, Progress, Keys, Usage Report and Reviews.
- **Reviews**: comment, approve, request changes and suggest values on messages, as editor comments on each locale file. Reviews live in `.x18n/reviews.yml`, so they travel with the branch.
- **Status bar**: the display locale; click to switch.
- **x18n UI** in a panel, also opened at a single key from hovers and views.
- Copy a translate prompt for an agent or LLM, or hand it to the editor's chat agent, from the palette, a hover or a key.
- Schema validation for `x18n.config.json`, `x18n.config.y(a)ml` and `*.x18n-plugin.y(a)ml` (YAML needs the Red Hat YAML extension).
- **Migration from i18n-ally**: when `.vscode/settings.json` has `i18n-ally.*` settings and there is no x18n config, the extension offers to generate one and shows it before writing.

Project settings live in `x18n.config.ts`; the settings below only change the editor experience.

## Commands

<!-- commands -->

| Command                      | Title                                 |
| ---------------------------- | ------------------------------------- |
| `x18n.findKeyByText`         | x18n: Find Key by Text         |
| `x18n.openUi`                | x18n: Open UI                |
| `x18n.openKey`               | x18n: Open Key in UI               |
| `x18n.setDisplayLocale`      | x18n: Set Display Locale      |
| `x18n.setLanguage`           | x18n: Set Extension UI Language           |
| `x18n.editKey`               | x18n: Edit Message               |
| `x18n.renameKeyPrefix`       | x18n: Rename Key Prefix       |
| `x18n.deleteKey`             | x18n: Delete Key             |
| `x18n.deleteUnusedKeys`      | x18n: Delete Unused Keys      |
| `x18n.extract`               | x18n: Extract Hard String               |
| `x18n.extractFile`           | x18n: Extract All Hard Strings in File           |
| `x18n.copyTranslatePrompt`   | x18n: Copy Translate Prompt   |
| `x18n.translateWithAgent`    | x18n: Translate with Agent    |
| `x18n.goToNextUsage`         | x18n: Go to Next Key Usage         |
| `x18n.goToPrevUsage`         | x18n: Go to Previous Key Usage         |
| `x18n.toggleInPlace`         | x18n: Toggle In-place Annotations         |
| `x18n.restartServer`         | x18n: Restart Language Server         |
| `x18n.migrateFromI18nAlly`   | x18n: Migrate from i18n-ally   |
| `x18n.showOutput`            | x18n: Show Output            |
| `x18n.explainProjects`       | x18n: Explain Projects       |
| `x18n.addReview`             | x18n: Review Key             |
| `x18n.replyReview`           | x18n: Comment           |
| `x18n.approveReview`         | x18n: Approve         |
| `x18n.requestReviewChange`   | x18n: Request Change   |
| `x18n.suggestReview`         | x18n: Suggest as Value         |
| `x18n.resolveReviewComment`  | x18n: Resolve  |
| `x18n.applyReviewSuggestion` | x18n: Apply Suggestion |

<!-- commands -->

## Configurations

<!-- configs -->

| Key                                     | Description                               | Type      | Default |
| --------------------------------------- | ----------------------------------------- | --------- | ------- |
| `x18n.enabled`                          | Run the x18n language server in this workspace.                          | `boolean` | `true`  |
| `x18n.useLocalServer`                   | Run the `@x18n/lsp` installed in the workspace's `node_modules` instead of the bundled server, when there is one. Restart the server after changing this.                   | `boolean` | `true`  |
| `x18n.annotations`                      | Show translated values next to or in place of keys in code.                      | `boolean` | `true`  |
| `x18n.annotationInPlace`                | Replace keys in code with their display-locale value. The raw key shows on the cursor line and inside selections.                | `boolean` | `true`  |
| `x18n.annotationInPlaceFullMatch`       | In in-place mode, replace the whole translate call, such as `t('key', { n })`, instead of only the key. Keys whose call is not known keep the key-only replacement.       | `boolean` | `false` |
| `x18n.annotationMaxLength`              | Longest value shown in an annotation. Longer values are truncated, and in-place mode falls back to an after-key hint.              | `number`  | `40`    |
| `x18n.language`                         | Language of x18n's messages, prompts and views. Empty follows VS Code's display language. Command titles and setting descriptions always follow VS Code's display language.                         | `string`  | `""`    |
| `x18n.displayLocale`                    | Locale shown in annotations. Empty means the source locale. "x18n: Set Display Locale" overrides it per workspace without writing settings, until this setting changes or you pick "Default".                    | `string`  | `""`    |
| `x18n.showFlags`                        | Show the flag of each locale in views, pickers, hovers and the status bar.                        | `boolean` | `true`  |
| `x18n.theme.annotation`                 | CSS color of in-place values. Empty uses the inlay hint color of the theme.                 | `string`  | `""`    |
| `x18n.theme.annotationMissing`          | CSS color of keys without a value. Empty uses the warning color of the theme.          | `string`  | `""`    |
| `x18n.theme.annotationBorder`           | CSS border color of in-place values. Empty draws no border.           | `string`  | `""`    |
| `x18n.theme.annotationMissingBorder`    | CSS border color of keys without a value. Empty draws no border.    | `string`  | `""`    |
| `x18n.theme.annotationInPlaceFullMatch` | CSS color of values that replace a whole call (`x18n.annotationInPlaceFullMatch`). Empty uses `x18n.theme.annotation`. | `string`  | `""`    |
| `x18n.codeLens`                         | Show usage counts and missing locales above keys in resource files.                         | `boolean` | `false` |
| `x18n.trace.server`                     | Trace the communication between VS Code and the x18n language server.                     | `string`  | `"off"` |

<!-- configs -->

## License

[MIT](./LICENSE.md)
