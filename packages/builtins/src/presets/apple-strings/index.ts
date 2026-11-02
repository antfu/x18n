import type { LocaleFinder, Preset, ResourceCandidate, Scanner, UsageCandidate } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
import { catalogLocales, fixedKeys, parseCatalog } from '../../formats/xcstrings'
import { printf } from '../../placeholders'

/** Xcode's default table, used by calls that name none. */
const defaultTable = 'Localizable'

const ignore = [
  '**/build/**',
  '**/Pods/**',
  '**/DerivedData/**',
  '**/Carthage/**',
  '**/node_modules/**',
]

/** Each `.lproj` file is one locale, and a catalog is read once per locale. */
const finder: LocaleFinder = {
  id: 'apple-strings',
  async find(ctx) {
    const paths = await ctx.host.glob(['**/*.lproj/*.{strings,stringsdict}'], { ignore, gitignore: true })
    const files: ResourceCandidate[] = paths.map((path) => {
      const parts = path.split('/')
      const folder = parts.at(-2)!.replace(/\.lproj$/, '')
      return {
        path,
        locale: folder === 'Base'
          ? ctx.config.sourceLocale
          : folder,
        namespace: parts.at(-1)!.replace(/\.[^.]+$/, ''),
      }
    })
    for (const path of await ctx.host.glob(['**/*.xcstrings'], { ignore, gitignore: true })) {
      const text = await ctx.host.readFile(path) ?? ''
      // A language the catalog doesn't have yet needs `locales` in the config: there is no new file to make for it.
      const locales = new Set([
        ...catalogLocales(parseCatalog(text, path)),
        ...ctx.config.locales ?? [],
      ])
      ;[...locales].forEach((locale, index) => {
        files.push({
          path,
          locale,
          namespace: path.slice(path.lastIndexOf('/') + 1).replace(/\.xcstrings$/, ''),
          block: {
            index,
            range: { start: 0, end: text.length },
            lang: locale,
          },
        })
      })
    }
    return files
  },
  resolveNew({ locale, namespace, model }) {
    if (model?.finder !== 'apple-strings' || model.block)
      return undefined
    const parts = model.path.split('/')
    const extension = parts.at(-1)!.slice(parts.at(-1)!.lastIndexOf('.'))
    parts[parts.length - 2] = `${locale}.lproj`
    parts[parts.length - 1] = `${namespace ?? defaultTable}${extension}`
    return parts.join('/')
  },
}

const string = '@?"((?:[^"\\\\\\n]|\\\\.)*)"'
const patterns: readonly RegExp[] = [
  // `NSLocalizedString("key", tableName: "T", comment: "")`, `NSLocalizedString(@"key", @"")`
  new RegExp(`\\bNSLocalizedString\\(\\s*${string}`, 'dg'),
  // `NSLocalizedStringFromTable(@"key", @"T", @"")`
  new RegExp(`\\bNSLocalizedStringFromTable\\(\\s*${string}\\s*,\\s*${string}`, 'dg'),
  // `String(localized: "key", table: "T")`, `LocalizedStringResource("key")`, `LocalizedStringKey("key")`
  new RegExp(`\\b(?:String\\(\\s*localized:|LocalizedStringResource\\(|LocalizedStringKey\\()\\s*${string}`, 'dg'),
  // SwiftUI views take a key: `Text("key")`, `Button("key") { }`, `Label("key", systemImage: "x")`
  new RegExp(`(?<![\\w.])(?:Text|Button|Label|Toggle|Link)\\(\\s*${string}`, 'dg'),
  // `"key".localized`, a common helper
  new RegExp(`${string}\\s*\\.\\s*localized\\b`, 'dg'),
]

/** The table a call names after its key, as `tableName: "T"` or `table: "T"`, on the rest of the call. */
function tableOf(text: string, from: number): string | undefined {
  const rest = /^[^()\n]*/.exec(text.slice(from))![0]
  return /\b(?:tableName|table)\s*:\s*"([^"]+)"/.exec(rest)?.[1]
}

function scannerOf(notMessages: ReadonlySet<string>): Scanner {
  return {
    id: 'apple-strings',
    extensions: ['swift', 'm', 'mm'],
    scan(file) {
      const usages: UsageCandidate[] = []
      for (const pattern of patterns) {
        for (const match of file.text.matchAll(pattern)) {
          const [start, end] = match.indices![1]!
          const raw = match[1]!
          const namespace = match[2] ?? tableOf(file.text, match.index + match[0].length) ?? defaultTable
          // `\\(x)` is `%@` or `%lld` in a key, by its type at compile time, so what's known is the part before it.
          const at = raw.indexOf('\\(')
          if (at === 0 || notMessages.has(raw))
            continue
          usages.push(at === -1
            ? {
                raw,
                range: { start, end },
                kind: 'call',
                dynamic: false,
                namespace,
              }
            : {
                raw: raw.slice(0, at),
                range: { start, end: start + at },
                kind: 'call',
                dynamic: 'prefix',
                namespace,
              })
        }
      }
      return {
        usages,
        keySlots: usages.filter(usage => usage.dynamic === false).map(usage => usage.range),
      }
    },
  }
}

/** Apple strings files, `en.lproj/Localizable.strings` and `.stringsdict`, and string catalogs, used from Swift, SwiftUI and Objective-C. The file name is the namespace. */
export function appleStrings(): Preset {
  const notMessages = new Set<string>()
  return {
    name: 'apple-strings',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:apple-strings',
        finders: [finder],
        // Keys are often the English sentence, so nothing in them is a separator.
        keySeparator: false,
        namespace: { separator: ':', default: defaultTable },
        // `String(localized: "\\(n) items")` reads `%lld items.one` from a catalog or a `.stringsdict`.
        derivedKeys: ['{key}.{plural}', '{key}.**'],
        placeholders: [printf],
        extra: async (_, ctx) => {
          notMessages.clear()
          for (const path of await ctx.host.glob(['**/*.xcstrings'], { ignore, gitignore: true })) {
            for (const key of fixedKeys(parseCatalog(await ctx.host.readFile(path) ?? '{"strings":{}}', path)))
              notMessages.add(key)
          }
        },
      }),
      {
        name: 'x18n:apple-strings-scanner',
        scanners: [
          scannerOf(notMessages),
        ],
      },
    ],
  }
}

export default appleStrings
