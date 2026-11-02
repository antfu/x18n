import type { MessageOp, MessageTree, NodeRange, Plugin, TextRange } from '@x18n/core'
import { diffText, errors, pathId, walkLeaves } from '@x18n/core'
import { detectEol, leafText, splice } from '../shared'
import { decodeXml, escapeXmlText, indentAt, xmlLine } from '../shared/xml'

/** A `<key>` and its value, among the children of a `<dict>`. */
interface Pair {
  readonly name: string
  readonly nameRange: TextRange
  readonly tag: string
  /** The value element. */
  readonly element: TextRange
  /** Inside the value element. */
  readonly inner: TextRange
  /** From `<key>` to the end of the value. */
  readonly range: TextRange
}

/** Children of the dict whose content is `range`. */
function pairsIn(text: string, range: TextRange): Pair[] {
  const out: Pair[] = []
  const key = /<!--[\s\S]*?-->|<key>([\s\S]*?)<\/key>\s*<(\w+)\s*(\/?)>/dg
  key.lastIndex = range.start
  for (let match = key.exec(text); match && match.index < range.end; match = key.exec(text)) {
    if (match[1] === undefined)
      continue
    const tag = match[2]!
    const open = match.index + match[0].length
    const start = open - `<${tag}>`.length - (match[3] ? 1 : 0)
    if (match[3]) {
      out.push({
        name: decodeXml(match[1]),
        nameRange: { start: match.indices![1]![0], end: match.indices![1]![1] },
        tag,
        element: { start, end: open },
        inner: { start: open, end: open },
        range: { start: match.index, end: open },
      })
      continue
    }
    // Plists nest dicts, so count to the closing tag.
    let depth = 1
    const tags = new RegExp(`<(/?)${tag}\\s*(/?)>`, 'g')
    tags.lastIndex = open
    let end = -1
    for (let t = tags.exec(text); t; t = tags.exec(text)) {
      if (t[2])
        continue
      depth += t[1]
        ? -1
        : 1
      if (depth === 0) {
        end = t.index
        key.lastIndex = t.index + t[0].length
        break
      }
    }
    if (end === -1)
      break
    const closed = key.lastIndex
    out.push({
      name: decodeXml(match[1]),
      nameRange: { start: match.indices![1]![0], end: match.indices![1]![1] },
      tag,
      element: { start, end: closed },
      inner: { start: open, end },
      range: { start: match.index, end: closed },
    })
  }
  return out
}

function rootDict(text: string, path: string): TextRange {
  const open = /<plist\b[^>]*>\s*<dict\s*>/.exec(text)
  if (!open)
    throw errors.X18N2002({ path, reason: 'missing <plist><dict>' })
  const end = text.lastIndexOf('</dict>')
  if (end === -1)
    throw errors.X18N2002({ path, reason: 'missing </dict>' })
  return { start: open.index + open[0].length, end }
}

interface Rule {
  readonly key: string
  readonly variable: string
  readonly many: boolean
  readonly pairs: readonly Pair[]
  readonly variableDict: Pair
  readonly keyRange: TextRange
  readonly entry: Pair
}

function rules(text: string, path: string): Rule[] {
  return pairsIn(text, rootDict(text, path)).filter(pair => pair.tag === 'dict').flatMap((entry) => {
    const dicts = pairsIn(text, entry.inner).filter(pair => pair.tag === 'dict')
    return dicts.map(variableDict => ({
      key: entry.name,
      variable: variableDict.name,
      many: dicts.length > 1,
      pairs: pairsIn(text, variableDict.inner).filter(pair => pair.tag === 'string' && !pair.name.startsWith('NSString')),
      variableDict,
      keyRange: entry.nameRange,
      entry,
    }))
  })
}

function stored(rule: Rule, quantity: string): string {
  return rule.many
    ? `${rule.key}.${rule.variable}.${quantity}`
    : `${rule.key}.${quantity}`
}

function read(text: string, path: string): { key: string, value: string, range: NodeRange }[] {
  return rules(text, path).flatMap(rule => rule.pairs.map(pair => ({
    key: stored(rule, pair.name),
    value: decodeXml(text.slice(pair.inner.start, pair.inner.end)),
    range: { key: rule.keyRange, value: pair.inner },
  })))
}

function find(text: string, key: string, path: string): { rule: Rule, pair: Pair | undefined, quantity: string } | undefined {
  for (const rule of rules(text, path)) {
    const prefix = rule.many
      ? `${rule.key}.${rule.variable}.`
      : `${rule.key}.`
    if (key.startsWith(prefix)) {
      const quantity = key.slice(prefix.length)
      return {
        rule,
        pair: rule.pairs.find(pair => pair.name === quantity),
        quantity,
      }
    }
  }
  return undefined
}

function newEntry(key: string, eol: string): { name: string, quantity: string, block: (value: string) => string } {
  const at = key.lastIndexOf('.')
  const name = at === -1
    ? key
    : key.slice(0, at)
  const quantity = at === -1
    ? 'other'
    : key.slice(at + 1)
  const line = (depth: number, body: string): string => `${'\t'.repeat(depth)}${body}${eol}`
  return {
    name,
    quantity,
    block: value => [
      line(1, `<key>${escapeXmlText(name)}</key>`),
      line(1, '<dict>'),
      line(2, '<key>NSStringLocalizedFormatKey</key>'),
      line(2, '<string>%#@value@</string>'),
      line(2, '<key>value</key>'),
      line(2, '<dict>'),
      line(3, '<key>NSStringFormatSpecTypeKey</key>'),
      line(3, '<string>NSStringPluralRuleType</string>'),
      line(3, '<key>NSStringFormatValueTypeKey</key>'),
      line(3, '<string>d</string>'),
      line(3, `<key>${quantity}</key>`),
      line(3, `<string>${value}</string>`),
      line(2, '</dict>'),
      line(1, '</dict>'),
    ].join(''),
  }
}

function applyOp(text: string, op: MessageOp, path: string): string {
  const key = op.path.join('.')
  const found = find(text, key, path)
  if (op.type === 'delete') {
    if (!found?.pair)
      return text
    // The last quantity takes its message with it.
    if (found.rule.pairs.length === 1 && !found.rule.many)
      return splice(text, xmlLine(text, found.rule.entry.range), '')
    return splice(text, xmlLine(text, found.pair.range), '')
  }
  const value = escapeXmlText(leafText(op.value))
  if (found?.pair)
    return splice(text, found.pair.inner, value)
  const eol = detectEol(text)
  if (found) {
    let at = found.rule.variableDict.inner.end
    while (text[at - 1] === ' ' || text[at - 1] === '\t')
      at--
    const indent = `${indentAt(text, found.rule.variableDict.range.start)}\t`
    return splice(text, { start: at, end: at }, `${indent}<key>${found.quantity}</key>${eol}${indent}<string>${value}</string>${eol}`)
  }
  const root = rootDict(text, path)
  let at = root.end
  while (text[at - 1] === ' ' || text[at - 1] === '\t')
    at--
  return splice(text, { start: at, end: at }, newEntry(key, eol).block(value))
}

const empty = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n</dict>\n</plist>\n'

/** Apple `.stringsdict` plurals: `<key>items</key>` with its quantities as `items.one`, or `items.count.one` when it has several variables. */
export function stringsdict(): Plugin {
  return {
    name: 'x18n:format-stringsdict',
    formats: [
      {
        id: 'stringsdict',
        extensions: ['stringsdict'],
        parse(text, ctx) {
          const tree: Record<string, string> = {}
          const ranges = new Map<string, NodeRange>()
          for (const entry of read(text, ctx.path)) {
            tree[entry.key] = entry.value
            ranges.set(pathId([entry.key]), entry.range)
          }
          return { tree, ranges }
        },
        edit(text, ops, ctx) {
          let next = text
          for (const op of ops)
            next = applyOp(next, op, ctx.path)
          return diffText(text, next)
        },
        serialize(tree: MessageTree, ctx) {
          let out = empty
          for (const leaf of walkLeaves(tree))
            out = applyOp(out, { type: 'set', path: leaf.path, value: leaf.value }, ctx.path)
          return out
        },
      },
    ],
  }
}

export default stringsdict
