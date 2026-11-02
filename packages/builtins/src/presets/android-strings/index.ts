import type { LocaleFinder, Preset, Scanner, UsageCandidate } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
import { printf } from '../../placeholders'

/** `values-fr` is `fr`, `values-zh-rCN` is `zh-CN`, `values-b+sr+Latn` is `sr-Latn`, and `values-night` is no locale. */
function folderLocale(folder: string, source: string): string | undefined {
  const match = /^values(?:-([a-z]{2,3})(?:-r([A-Z]{2}))?|-b\+([A-Za-z\d+]+))?$/.exec(folder)
  if (!match)
    return undefined
  if (match[3])
    return match[3].replace(/\+/g, '-')
  if (!match[1])
    return source
  return match[2]
    ? `${match[1]}-${match[2]}`
    : match[1]
}

function localeFolder(locale: string, source: string): string {
  if (locale === source)
    return 'values'
  const parts = locale.split('-')
  if (parts.length === 1)
    return `values-${locale}`
  return parts.length === 2 && /^[A-Z]{2}$/.test(parts[1]!)
    ? `values-${parts[0]}-r${parts[1]}`
    : `values-b+${parts.join('+')}`
}

const finder: LocaleFinder = {
  id: 'android-strings',
  async find(ctx) {
    const paths = await ctx.host.glob(['**/res/values*/*.xml'], {
      ignore: ['**/build/**', '**/node_modules/**'],
      gitignore: true,
    })
    return paths.flatMap((path) => {
      const parts = path.split('/')
      const locale = folderLocale(parts.at(-2)!, ctx.config.sourceLocale)
      return locale && /(?:strings|plurals|arrays)[^/]*\.xml$/.test(parts.at(-1)!)
        ? [
            { path, locale, namespace: undefined },
          ]
        : []
    })
  },
  resolveNew({ locale, model }, ctx) {
    if (model?.finder !== 'android-strings')
      return undefined
    const parts = model.path.split('/')
    parts[parts.length - 2] = localeFolder(locale, ctx.config.sourceLocale)
    return parts.join('/')
  },
}

/** `translatable="false"` strings aren't messages, so a usage of one is not a missing key. */
const fixed = /<(?:string|plurals|string-array)\b[^>]*>/g

function fixedNames(code: string): string[] {
  return [
    ...code.matchAll(fixed),
  ].flatMap((match) => {
    const name = /\bname\s*=\s*"([^"]+)"/.exec(match[0])?.[1]
    return name && /\btranslatable\s*=\s*"false"/.test(match[0])
      ? [name]
      : []
  })
}

function scanner(notMessages: ReadonlySet<string>): Scanner {
  return {
    id: 'android-strings',
    extensions: ['kt', 'kts', 'java', 'xml'],
    scan(file) {
      // In code `R.string.key`, in layouts and manifests `@string/key`.
      const pattern = file.extension === 'xml'
        ? /@(?:string|plurals|array)\/(\w[\w.]*)/dg
        : /\bR\s*\.\s*(?:string|plurals|array)\s*\.\s*(\w+)/dg
      const usages: UsageCandidate[] = []
      for (const match of file.text.matchAll(pattern)) {
        if (notMessages.has(match[1]!))
          continue
        const [start, end] = match.indices![1]!
        usages.push({
          raw: match[1]!,
          range: { start, end },
          kind: 'call',
          dynamic: false,
        })
      }
      return {
        usages,
        keySlots: usages.map(usage => usage.range),
      }
    },
  }
}

/** Android string resources: `res/values/strings.xml` and `res/values-fr/strings.xml`, used as `R.string.key` and `@string/key`. */
export function androidStrings(): Preset {
  const notMessages = new Set<string>()
  return {
    name: 'android-strings',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:android-strings',
        finders: [finder],
        keyStyle: 'flat',
        // `R.plurals.items` and `R.array.days` read `items.one` and `days.0`.
        derivedKeys: ['{key}.{plural}', '{key}.*'],
        placeholders: [printf],
        extra: async (_, ctx) => {
          notMessages.clear()
          const paths = await ctx.host.glob(['**/res/values*/*.xml'], {
            ignore: ['**/build/**', '**/node_modules/**'],
            gitignore: true,
          })
          for (const path of paths) {
            for (const name of fixedNames(await ctx.host.readFile(path) ?? ''))
              notMessages.add(name)
          }
        },
      }),
      {
        name: 'x18n:android-strings-scanner',
        scanners: [
          scanner(notMessages),
        ],
      },
    ],
  }
}

export default androidStrings
