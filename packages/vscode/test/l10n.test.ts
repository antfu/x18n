import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { bundleTranslator, format, l10n, setTranslator } from '../src/model/l10n'
import { languages } from '../src/model/languages'
import { reviewItems, usageReportItems } from '../src/model/tree'

const root = fileURLToPath(new URL('../', import.meta.url))
/** VS Code display languages the extension ships, matching the languages of the x18n UI. */
const locales = [
  'de',
  'es',
  'fr',
  'ja',
  'ko',
  'pt-br',
  'ru',
  'tr',
  'zh-cn',
  'zh-tw',
]

const readJson = async (path: string): Promise<Record<string, string>> => JSON.parse(await readFile(join(root, path), 'utf8'))

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(join(root, dir), { recursive: true, withFileTypes: true })
  return Promise.all(entries.filter(e => e.isFile() && e.name.endsWith('.ts')).map(e => readFile(join(e.parentPath, e.name), 'utf8')))
}

/** The literal messages of every `l10n.t('...')` call, in the extension and in the view models. */
async function messages(): Promise<Set<string>> {
  const found = new Set<string>()
  for (const text of await sources('src')) {
    for (const [, message] of text.matchAll(/\bl10n\.t\(\s*'((?:[^'\\]|\\.)*)'/g))
      found.add(message!.replace(/\\(.)/g, '$1'))
  }
  return found
}

/** What a translation must keep as written: `{0}` arguments, `$(codicon)`s and code spans. */
function fixed(text: string): string[] {
  return [
    ...text.matchAll(/\{\w+\}|\$\([\w-]+\)|`[^`]*`/g),
  ].map(m => m[0]).sort()
}

describe('model translator', () => {
  afterEach(() => setTranslator(undefined))

  it('formats English with positional arguments by default', () => {
    expect(format('Delete {0} in {1}? {2}', ['a', 2])).toBe('Delete a in 2? {2}')
    expect(l10n.t('Usages: {0}', 3)).toBe('Usages: 3')
  })

  it('translates from a bundle, in English for a message the bundle lacks', () => {
    const t = bundleTranslator({ 'Usages: {0}': 'Kullanımlar: {0}', 'Missing': '' })
    expect(t('Usages: {0}', 3)).toBe('Kullanımlar: 3')
    expect(t('Missing')).toBe('Missing')
    expect(t('Unused')).toBe('Unused')
  })

  it('sends view model strings through the injected translator', async () => {
    const asked: [string, unknown[]][] = []
    setTranslator((message, ...args) => {
      asked.push([message, args])
      return `[${format(message, args)}]`
    })
    const location = {
      uri: 'file:///w/App.vue',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    }
    const [unused, missing] = usageReportItems({
      unused: [],
      missing: [
        {
          project: 'app',
          key: 'a',
          locations: [location, location],
        },
      ],
    })
    expect([unused!.label, missing!.label]).toEqual(['[Unused]', '[Missing]'])
    expect((await missing!.children!())[0]!.description).toBe('[Usages: 2]')
    expect(asked).toContainEqual([
      'Usages: {0}',
      [2],
    ])
    const [thread] = reviewItems({
      threads: [
        {
          project: 'app',
          key: 'a',
          locale: 'de',
          state: 'approved',
          location,
          comments: [],
        },
      ],
    })
    expect(thread!.description).toBe('de · [approved]')
  })
})

describe('translations', () => {
  it('lists every runtime message in the English bundle, and nothing else', async () => {
    const bundle = await readJson('l10n/bundle.l10n.json')
    expect(Object.keys(bundle).sort()).toEqual([
      ...await messages(),
    ].sort())
    for (const [key, value] of Object.entries(bundle))
      expect(value).toBe(key)
  })

  it('defines every package.json string in package.nls.json, and nothing else', async () => {
    const manifest = await readFile(join(root, 'package.json'), 'utf8')
    const used = [
      ...manifest.matchAll(/"%([^"%]+)%"/g),
    ].map(m => m[1]!)
    expect(Object.keys(await readJson('package.nls.json')).sort()).toEqual([
      ...new Set(used),
    ].sort())
  })

  it.each(locales)('translates every string into %s', async (locale) => {
    for (const [english, translated] of [
      [await readJson('package.nls.json'), await readJson(`package.nls.${locale}.json`)],
      [await readJson('l10n/bundle.l10n.json'), await readJson(`l10n/bundle.l10n.${locale}.json`)],
    ] as const) {
      expect(Object.keys(translated)).toEqual(Object.keys(english))
      for (const [key, value] of Object.entries(translated)) {
        expect(value.trim(), key).not.toBe('')
        expect(fixed(value), `${locale}: ${key}`).toEqual(fixed(english[key]!))
      }
    }
  })

  it('offers every shipped locale, and English, in x18n.language and its picker', async () => {
    const manifest: { contributes: { configuration: { properties: Record<string, { enum: string[], enumItemLabels: string[] }> } } } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const setting = manifest.contributes.configuration.properties['x18n.language']!
    expect(setting.enum).toEqual(['', 'en', ...locales])
    // The Set Language picker lists the same languages, by the same names.
    expect(languages.map(l => l.code)).toEqual(setting.enum.slice(1))
    expect(languages.map(l => l.name)).toEqual(setting.enumItemLabels.slice(1))
  })

  it('ships no other locale', async () => {
    const files = [
      ...(await readdir(root)).filter(f => f.startsWith('package.nls.')),
      ...await readdir(join(root, 'l10n')),
    ]
    const shipped = new Set(files.map(f => /\.([\w-]+)\.json$/.exec(f)![1]).filter(l => l !== 'nls' && l !== 'l10n'))
    expect([...shipped].sort()).toEqual(locales)
  })
})
