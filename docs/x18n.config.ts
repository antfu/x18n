import diglot from '@diglot/x18n'
import { defineConfig } from '@x18n/core'

/**
 * The docs translations, dogfooded in x18n through diglot's plugin: the store is `i18n/`, segment
 * hashes are keys, `i18n/.diglot/manifest` holds the English messages, and each record is a
 * translation. Usages come from `i18n/.diglot/sources`, which `pnpm -C docs run i18n:checkout` exports.
 */
export default defineConfig({
  plugins: [
    diglot({ root: 'i18n' }),
  ],
  checks: {
    // Product names, check ids and code-like segments read the same in every locale.
    'identical-to-source': 'off',
  },
})
