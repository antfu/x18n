import type { ScannerEntry } from '@x18n/core'
import astro from './astro/entry'
import js from './js/entry'
import svelte from './svelte/entry'
import vue from './vue/entry'

/**
 * Built-in scanners by id, in scan order. A scanner is a folder: `<name>/entry.ts` holds its extensions and a
 * `load` for `<name>/index.ts`, imported when a file it scans is first scanned. `regex` is not here: its
 * extensions come from `usage.regex`, so it is always loaded. Nor is `html`: the Angular presets list it, since a plain
 * `index.html` is not where most apps keep their text.
 */
export const scanners: { readonly [id: string]: ScannerEntry } = { js, vue, svelte, astro }
