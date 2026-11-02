import type { MessageOp, MessageTree, NodeRange, Plugin, TextRange } from '@x18n/core'
import { diffText, errors, pathId, walkLeaves } from '@x18n/core'
import { findNodeAtLocation, parseTree } from 'jsonc-parser'
import { leafText } from '../shared'

const quantities = new Set([
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
])

interface StringUnit { state?: string, value?: string }
interface Variant { stringUnit?: StringUnit, variations?: Variations }
interface Variations { [kind: string]: { [name: string]: Variant } }
interface Localization { stringUnit?: StringUnit, variations?: Variations }
interface Entry { comment?: string, shouldTranslate?: boolean, localizations?: { [locale: string]: Localization } }
export interface Catalog { sourceLanguage: string, strings: { [key: string]: Entry }, version?: string }

export function parseCatalog(text: string, path: string): Catalog {
  try {
    const catalog = JSON.parse(text) as Catalog
    if (catalog && typeof catalog.strings === 'object')
      return catalog
  }
  catch {}
  throw errors.X18N2002({ path, reason: 'not a string catalog' })
}

/** What each locale of a catalog is written in, for the finder. */
export function catalogLocales(catalog: Catalog): string[] {
  const found = new Set([catalog.sourceLanguage])
  for (const entry of Object.values(catalog.strings)) {
    for (const locale of Object.keys(entry.localizations ?? {}))
      found.add(locale)
  }
  return [...found]
}

/** Keys Xcode marks as never translated. */
export function fixedKeys(catalog: Catalog): string[] {
  return Object.entries(catalog.strings).filter(([, entry]) => entry.shouldTranslate === false).map(([key]) => key)
}

/** The leaves of a localization, with their path in it: a plain unit, or `plural.one`, `device.iphone`, and those nested. */
function leaves(node: Localization | Variant, trail: readonly string[] = []): { trail: readonly string[], unit: StringUnit }[] {
  if (node.stringUnit) {
    return [
      { trail, unit: node.stringUnit },
    ]
  }
  return Object.entries(node.variations ?? {}).flatMap(([kind, variants]) => Object.entries(variants).flatMap(([name, variant]) => leaves(variant, [...trail, kind, name])))
}

/** `plural.one` is `key.one`, as plurals are everywhere else; other variations keep their kind. */
function suffix(trail: readonly string[]): string {
  return trail.flatMap((part, i) => i % 2 === 0 && part === 'plural'
    ? []
    : [part]).map(part => `.${part}`).join('')
}

function location(key: string, locale: string, trail: readonly string[]): (string | number)[] {
  return [
    'strings',
    key,
    'localizations',
    locale,
    ...trail.flatMap((part, i) => i % 2 === 0
      ? ['variations', part]
      : [part]),
    'stringUnit',
    'value',
  ]
}

/** Xcode's own layout, so that a write changes only what it must. */
function stringify(value: unknown, indent = ''): string {
  if (typeof value !== 'object' || value === null)
    return JSON.stringify(value)
  const next = `${indent}  `
  const keys = Object.entries(value)
  if (!keys.length)
    return `{\n\n${indent}}`
  return `{\n${keys.map(([key, item]) => `${next}${JSON.stringify(key)} : ${stringify(item, next)}`).join(',\n')}\n${indent}}`
}

function insertSorted<T>(object: { [key: string]: T }, key: string, value: T): void {
  const entries = Object.entries(object)
  const at = entries.findIndex(([other]) => other.localeCompare(key) > 0)
  entries.splice(at === -1
    ? entries.length
    : at, 0, [key, value])
  for (const [name] of entries)
    delete object[name]
  for (const [name, item] of entries)
    object[name] = item
}

/** The catalog key and variation of a stored key: `items.one` when `items` is in the catalog, or a new plural. */
function resolve(catalog: Catalog, stored: string): { key: string, quantity: string | undefined } {
  if (catalog.strings[stored])
    return { key: stored, quantity: undefined }
  const at = stored.lastIndexOf('.')
  const tail = stored.slice(at + 1)
  return at !== -1 && quantities.has(tail)
    ? {
        key: stored.slice(0, at),
        quantity: tail,
      }
    : { key: stored, quantity: undefined }
}

function setLeaf(catalog: Catalog, stored: string, locale: string, value: string): void {
  const { key, quantity } = resolve(catalog, stored)
  if (!catalog.strings[key])
    insertSorted(catalog.strings, key, {})
  const entry = catalog.strings[key]!
  entry.localizations ??= {}
  if (!entry.localizations[locale])
    insertSorted(entry.localizations, locale, {})
  const localization = entry.localizations[locale]!
  const unit = { state: 'translated', value }
  if (!quantity) {
    localization.stringUnit = unit
    return
  }
  localization.variations ??= {}
  localization.variations.plural ??= {}
  if (!localization.variations.plural[quantity])
    insertSorted(localization.variations.plural, quantity, {})
  localization.variations.plural[quantity]!.stringUnit = unit
}

function removeLeaf(catalog: Catalog, stored: string, locale: string): void {
  const { key, quantity } = resolve(catalog, stored)
  const entry = catalog.strings[key]
  if (!entry)
    return
  const localization = entry.localizations?.[locale]
  if (quantity && localization?.variations?.plural) {
    delete localization.variations.plural[quantity]
    if (Object.keys(localization.variations.plural).length)
      return
  }
  delete entry.localizations?.[locale]
  // Without any translation, the key leaves the catalog with its source.
  if (locale === catalog.sourceLanguage && !Object.keys(entry.localizations ?? {}).length)
    delete catalog.strings[key]
}

function applyOps(text: string, ops: readonly MessageOp[], locale: string, path: string): string {
  const catalog = parseCatalog(text, path)
  for (const op of ops) {
    if (op.type === 'set')
      setLeaf(catalog, op.path.join('.'), locale, leafText(op.value))
    else
      removeLeaf(catalog, op.path.join('.'), locale)
  }
  return `${stringify(catalog)}\n`
}

/** Apple string catalogs: every locale in one JSON file, read for one locale at a time. */
export function xcstrings(): Plugin {
  return {
    name: 'x18n:format-xcstrings',
    formats: [
      {
        id: 'xcstrings',
        extensions: ['xcstrings'],
        parse(text, ctx) {
          const catalog = parseCatalog(text, ctx.path)
          const root = parseTree(text)
          const tree: Record<string, string> = {}
          const ranges = new Map<string, NodeRange>()
          const descriptions = new Map<string, string>()
          const rangeOf = (at: (string | number)[]): TextRange | undefined => {
            const node = root && findNodeAtLocation(root, at)
            return node && { start: node.offset, end: node.offset + node.length }
          }
          for (const [key, entry] of Object.entries(catalog.strings)) {
            if (entry.shouldTranslate === false)
              continue
            const keyNode = root && findNodeAtLocation(root, ['strings', key])?.parent?.children?.[0]
            const keyRange = keyNode
              ? { start: keyNode.offset, end: keyNode.offset + keyNode.length }
              : { start: 0, end: 0 }
            const found = leaves(entry.localizations?.[ctx.locale] ?? {}).filter(leaf => leaf.unit.value !== undefined)
            // A key with no source text is its own text, as Xcode reads it.
            if (!found.length && ctx.locale === catalog.sourceLanguage) {
              tree[key] = key
              ranges.set(pathId([key]), { key: keyRange, value: keyRange })
            }
            for (const { trail, unit } of found) {
              const stored = `${key}${suffix(trail)}`
              tree[stored] = unit.value!
              const value = rangeOf(location(key, ctx.locale, trail)) ?? keyRange
              ranges.set(pathId([stored]), { key: keyRange, value })
            }
            if (entry.comment) {
              for (const stored of Object.keys(tree).filter(name => name === key || name.startsWith(`${key}.`)))
                descriptions.set(pathId([stored]), entry.comment)
            }
          }
          return { tree, ranges, descriptions }
        },
        edit: (text, ops, ctx) => diffText(text, applyOps(text, ops, ctx.locale, ctx.path)),
        serialize(tree: MessageTree, ctx) {
          const catalog: Catalog = { sourceLanguage: ctx.locale, strings: {}, version: '1.0' }
          for (const leaf of walkLeaves(tree))
            setLeaf(catalog, leaf.path.join('.'), ctx.locale, leafText(leaf.value))
          return `${stringify(catalog)}\n`
        },
      },
    ],
  }
}

export default xcstrings
