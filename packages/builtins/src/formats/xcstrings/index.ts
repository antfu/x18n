import type { MessageOp, MessageTree, NodeRange, Plugin, TextRange } from '@x18n/core'
import type { Node } from 'jsonc-parser'
import { diffText, errors, pathId, walkLeaves } from '@x18n/core'
import { findNodeAtLocation, parseTree } from 'jsonc-parser'
import { leafText, splice } from '../shared'
import { indentAt } from '../shared/xml'

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

/** The variation path of a suffix, the reverse of `suffix`: `one` is `plural.one`, `device.iphone.one` is `device.iphone.plural.one`. */
function trailOf(parts: readonly string[]): string[] | undefined {
  const out: string[] = []
  for (let i = 0; i < parts.length;) {
    if (quantities.has(parts[i]!)) {
      out.push('plural', parts[i]!)
      i++
    }
    else if (i + 1 < parts.length) {
      out.push(parts[i]!, parts[i + 1]!)
      i += 2
    }
    else {
      return undefined
    }
  }
  return out
}

function variationPath(trail: readonly string[]): string[] {
  return trail.flatMap((part, i) => i % 2 === 0
    ? ['variations', part]
    : [part])
}

function location(key: string, locale: string, trail: readonly string[]): (string | number)[] {
  return [
    'strings',
    key,
    'localizations',
    locale,
    ...variationPath(trail),
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

interface Located {
  readonly key: string
  /** Variation path in the localization, `['plural', 'one']`; empty for a plain unit. */
  readonly trail: readonly string[]
}

/**
 * The catalog key and variation of a stored key: `items.one` and `items.device.iphone` when `items` is in the catalog,
 * the longest such key first; otherwise a new key, plural when it ends in a quantity.
 */
function resolve(catalog: Catalog, stored: string, renamed?: ReadonlyMap<string, string>): Located {
  const has = (key: string): boolean => Boolean(catalog.strings[key] ?? renamed?.has(key))
  if (has(stored))
    return { key: stored, trail: [] }
  for (let at = stored.lastIndexOf('.'); at > 0; at = stored.lastIndexOf('.', at - 1)) {
    const key = stored.slice(0, at)
    const trail = has(key) && trailOf(stored.slice(at + 1).split('.'))
    if (trail)
      return { key, trail }
  }
  const at = stored.lastIndexOf('.')
  return at > 0 && quantities.has(stored.slice(at + 1))
    ? {
        key: stored.slice(0, at),
        trail: [
          'plural',
          stored.slice(at + 1),
        ],
      }
    : { key: stored, trail: [] }
}

/** The text a locale shows for a located key, the key itself for a source without text. */
function valueOf(catalog: Catalog, at: Located, locale: string): string | undefined {
  const entry = catalog.strings[at.key]
  if (!entry)
    return undefined
  let node: Variant | undefined = entry.localizations?.[locale]
  for (let i = 0; node && i < at.trail.length; i += 2)
    node = node.variations?.[at.trail[i]!]?.[at.trail[i + 1]!]
  if (node?.stringUnit)
    return node.stringUnit.value
  const empty = !leaves(entry.localizations?.[locale] ?? {}).some(leaf => leaf.unit.value !== undefined)
  return !at.trail.length && locale === catalog.sourceLanguage && empty
    ? at.key
    : undefined
}

/** Sets or removes the unit at `trail` of a localization, pruning emptied variations. */
function change(root: Variant, trail: readonly string[], value: string | undefined): void {
  const parents: { node: Variant, kind: string, name: string }[] = []
  let node = root
  for (let i = 0; i < trail.length; i += 2) {
    const kind = trail[i]!
    const name = trail[i + 1]!
    if (value === undefined && !node.variations?.[kind]?.[name])
      return
    if (value !== undefined)
      delete node.stringUnit
    node.variations ??= {}
    node.variations[kind] ??= {}
    node.variations[kind][name] ??= {}
    parents.push({ node, kind, name })
    node = node.variations[kind][name]
  }
  if (value !== undefined) {
    node.stringUnit = { ...node.stringUnit, state: 'translated', value }
    delete node.variations
    return
  }
  delete node.stringUnit
  for (const { node: parent, kind, name } of parents.reverse()) {
    if (Object.keys(parent.variations![kind]![name]!).length)
      break
    delete parent.variations![kind]![name]
    if (!Object.keys(parent.variations![kind]!).length)
      delete parent.variations![kind]
    if (!Object.keys(parent.variations!).length)
      delete parent.variations
  }
}

/** The localization after setting or removing the unit at `trail`. */
function changed(localization: Localization | undefined, trail: readonly string[], value: string | undefined): Localization {
  const root = structuredClone(localization ?? {}) as Variant
  change(root, trail, value)
  return root
}

const nameOf = (property: Node): string => property.children![0]!.value as string

function propertyIn(object: Node | undefined, name: string): Node | undefined {
  return object?.children?.find(property => nameOf(property) === name)
}

const rangeOf = (node: Node): TextRange => ({ start: node.offset, end: node.offset + node.length })

/** Adds `name` to an object in key order, on a line of its own. */
function insertProperty(text: string, object: Node, name: string, value: unknown): string {
  const properties = object.children ?? []
  if (!properties.length) {
    const indent = indentAt(text, object.offset)
    return splice(text, rangeOf(object), stringify({ [name]: value }, indent))
  }
  const indent = indentAt(text, properties[0]!.offset)
  const property = `${JSON.stringify(name)} : ${stringify(value, indent)}`
  const before = properties.find(other => nameOf(other).localeCompare(name) > 0)
  if (before)
    return splice(text, { start: before.offset, end: before.offset }, `${property},\n${indent}`)
  const last = properties.at(-1)!
  const end = last.offset + last.length
  return splice(text, { start: end, end }, `,\n${indent}${property}`)
}

/** Removes a property with one of the commas beside it. */
function removeProperty(text: string, property: Node): string {
  const siblings = property.parent!.children!
  const at = siblings.indexOf(property)
  if (siblings.length === 1)
    return splice(text, rangeOf(property.parent!), `{\n\n${indentAt(text, property.parent!.offset)}}`)
  const previous = siblings[at - 1]
  return previous
    ? splice(text, { start: previous.offset + previous.length, end: property.offset + property.length }, '')
    : splice(text, { start: property.offset, end: siblings[at + 1]!.offset }, '')
}

/** Sets or removes one unit of one locale, touching only that locale's localization of the key. */
function writeUnit(text: string, path: string, at: Located, locale: string, value: string | undefined): string {
  const catalog = parseCatalog(text, path)
  const root = parseTree(text)!
  const strings = findNodeAtLocation(root, ['strings'])!
  const entryNode = findNodeAtLocation(root, ['strings', at.key])
  const entry = catalog.strings[at.key]
  if (!entry || !entryNode) {
    return value === undefined
      ? text
      : insertProperty(text, strings, at.key, {
          localizations: {
            [locale]: changed(undefined, at.trail, value),
          },
        })
  }
  const localizations = propertyIn(entryNode, 'localizations')
  const property = propertyIn(localizations?.children?.[1], locale)
  const current = entry.localizations?.[locale]
  const unitNode = property && findNodeAtLocation(property.children![1]!, [
    ...variationPath(at.trail),
    'stringUnit',
  ])
  if (value !== undefined && unitNode) {
    // Only the value and state change, so the rest of the unit keeps its text.
    const valueNode = findNodeAtLocation(unitNode, ['value'])
    const stateNode = findNodeAtLocation(unitNode, ['state'])
    if (valueNode && stateNode) {
      const edits = [
        {
          range: rangeOf(valueNode),
          text: JSON.stringify(value),
        },
        {
          range: rangeOf(stateNode),
          text: JSON.stringify('translated'),
        },
      ].sort((a, b) => b.range.start - a.range.start)
      return edits.reduce((out, edit) => splice(out, edit.range, edit.text), text)
    }
  }
  const next = changed(current, at.trail, value)
  if (Object.keys(next).length) {
    if (property)
      return splice(text, rangeOf(property.children![1]!), stringify(next, indentAt(text, property.offset)))
    if (localizations)
      return insertProperty(text, localizations.children![1]!, locale, next)
    return insertProperty(text, entryNode, 'localizations', { [locale]: next })
  }
  if (!property)
    return text
  if (Object.keys(entry.localizations!).length > 1)
    return removeProperty(text, property)
  // Without any translation, the key leaves the catalog with its source.
  return locale === catalog.sourceLanguage
    ? removeProperty(text, entryNode.parent!)
    : removeProperty(text, localizations!)
}

/** Renames a key of the catalog in place, so every locale and the comment move with it. */
function renameKey(text: string, from: string, to: string): string {
  const keyNode = findNodeAtLocation(parseTree(text)!, ['strings', from])!.parent!.children![0]!
  return splice(text, rangeOf(keyNode), JSON.stringify(to))
}

/**
 * A rename reaches a format as `delete from` and `set to` in each locale. The key holds every locale, so the source
 * locale renames it in place and the others leave it alone: the translation moves with the key.
 */
function renameOf(catalog: Catalog, del: MessageOp, set: MessageOp | undefined, locale: string, renamed: ReadonlyMap<string, string>): { from: Located, to: Located } | undefined {
  if (del.type !== 'delete' || set?.type !== 'set')
    return undefined
  const from = resolve(catalog, del.path.join('.'), renamed)
  const target = set.path.join('.')
  const end = suffix(from.trail)
  if (!target.endsWith(end) || target.length === end.length)
    return undefined
  const to = {
    key: target.slice(0, target.length - end.length),
    trail: from.trail,
  }
  const earlier = renamed.get(from.key)
  if (earlier !== undefined || to.key === from.key) {
    return earlier === to.key
      ? { from, to }
      : undefined
  }
  return !catalog.strings[to.key] && valueOf(catalog, from, locale) === leafText(set.value)
    ? { from, to }
    : undefined
}

function applyOps(text: string, ops: readonly MessageOp[], locale: string, path: string): string {
  let next = text
  const renamed = new Map<string, string>()
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    const catalog = parseCatalog(next, path)
    const rename = renameOf(catalog, op, ops[i + 1], locale, renamed)
    if (rename) {
      i++
      if (locale !== catalog.sourceLanguage)
        continue
      if (!renamed.has(rename.from.key)) {
        next = renameKey(next, rename.from.key, rename.to.key)
        renamed.set(rename.from.key, rename.to.key)
      }
      // A source without text was its key: it keeps the old text under the new key.
      const value = leafText((ops[i] as Extract<MessageOp, { type: 'set' }>).value)
      if (valueOf(parseCatalog(next, path), rename.to, locale) !== value)
        next = writeUnit(next, path, rename.to, locale, value)
      continue
    }
    const at = resolve(catalog, op.path.join('.'))
    next = writeUnit(next, path, at, locale, op.type === 'set'
      ? leafText(op.value)
      : undefined)
  }
  return next
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
          const source = ctx.locale === catalog.sourceLanguage
          const tree: Record<string, string> = {}
          const ranges = new Map<string, NodeRange>()
          const descriptions = new Map<string, string>()
          const rangeAt = (at: (string | number)[]): TextRange | undefined => {
            const node = root && findNodeAtLocation(root, at)
            return node && rangeOf(node)
          }
          for (const [key, entry] of Object.entries(catalog.strings)) {
            if (entry.shouldTranslate === false)
              continue
            const keyNode = root && findNodeAtLocation(root, ['strings', key])?.parent?.children?.[0]
            // Inside the quotes, so that a rename in place writes a valid key.
            const keyRange = keyNode
              ? { start: keyNode.offset + 1, end: keyNode.offset + keyNode.length - 1 }
              : { start: 0, end: 0 }
            const found = leaves(entry.localizations?.[ctx.locale] ?? {}).filter(leaf => leaf.unit.value !== undefined)
            const stored: string[] = []
            // A key with no source text is its own text, as Xcode reads it. It has no range: a rename in place
            // would change its text, so it is renamed by `edit`, which keeps the text.
            if (!found.length && source) {
              tree[key] = key
              stored.push(key)
            }
            for (const { trail, unit } of found) {
              const name = `${key}${suffix(trail)}`
              tree[name] = unit.value!
              stored.push(name)
              // The key is shared by every locale, so only the source has ranges: a rename in place then happens
              // once, and the other locales leave the key to it.
              if (source)
                ranges.set(pathId([name]), { key: keyRange, value: rangeAt(location(key, ctx.locale, trail)) ?? keyRange })
            }
            if (entry.comment) {
              for (const name of stored)
                descriptions.set(pathId([name]), entry.comment)
            }
          }
          return { tree, ranges, descriptions }
        },
        edit: (text, ops, ctx) => diffText(text, applyOps(text, ops, ctx.locale, ctx.path)),
        // Only for a new catalog, which then starts in the locale it is made for. A catalog holds every locale and a
        // format sees one, so this cannot rewrite an existing catalog (`write.sort`, `x18n format`) without losing the others.
        serialize(tree: MessageTree, ctx) {
          const empty = `${stringify({ sourceLanguage: ctx.locale, strings: {}, version: '1.0' })}\n`
          const ops = [
            ...walkLeaves(tree),
          ].map((leaf): MessageOp => ({ type: 'set', path: leaf.path, value: leaf.value }))
          return applyOps(empty, ops, ctx.locale, ctx.path)
        },
      },
    ],
  }
}

export default xcstrings
