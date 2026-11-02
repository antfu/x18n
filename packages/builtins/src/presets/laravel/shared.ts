import type { Plugin, ResourceSpec } from '@x18n/core'

/** PHP files nest keys (`messages.welcome`); JSON files are keyed by whole sentences (`Welcome back.`), so their keys are literal. */
export const laravelResources: readonly ResourceSpec[] = [
  { pattern: 'lang/{locale}/{namespaces}.php' },
  { pattern: 'resources/lang/{locale}/{namespaces}.php' },
  { pattern: 'lang/{locale}.json', keySeparator: false },
  { pattern: 'resources/lang/{locale}.json', keySeparator: false },
]

/** Nested translation files are referenced as `dir/file.key`. */
export const laravelKey: Plugin['normalizeKey'] = raw => raw.includes('/')
  ? raw.replace(/\//g, '.')
  : undefined
