import diglot from '@diglot/x18n'
import { defineConfig } from '@x18n/core'

/**
 * Shows this diglot store in x18n: segment hashes are keys, `.diglot/manifest` holds the English
 * messages, and each record is a translation. Usages come from `.diglot/sources`, which
 * `pnpm -C docs run i18n:checkout` exports. Run x18n from this directory, or with `--root docs/i18n`.
 */
export default defineConfig({
  plugins: [
    diglot(),
  ],
})
