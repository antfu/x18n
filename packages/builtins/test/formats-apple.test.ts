/* eslint-disable style/no-tabs */
import type { Format, MessageOp } from '@x18n/core'
import { applyTextEdits, pathId } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { strings } from '../src/formats/strings'
import { stringsdict } from '../src/formats/stringsdict'
import { xcstrings } from '../src/formats/xcstrings'
import { appleStrings } from '../src/presets/apple-strings'
import { createTestProject } from './_utils'

const ctx = {
  path: 'x',
  locale: 'fr',
  namespace: undefined,
  indent: undefined,
}

function editor(format: Format): (text: string, ops: MessageOp[]) => string {
  return (text, ops) => applyTextEdits(text, format.edit!(text, ops, ctx))
}

describe('strings format', () => {
  const format = strings().formats![0]!
  const edit = editor(format)
  const source = `/* Title of the page */
"page.title" = "Accueil";

// Button
"Save \\"it\\"" = "Enregistrer \\"ça\\"\\n";
bare_key = "Bare value";
"unicode" = "\\U00e9 \\\\ %@ %1$@";
"tight"="x";
/* Orphan comment */
`

  it('reads keys, values, escapes and comments', () => {
    const { tree, descriptions } = format.parse(source, ctx)
    expect(tree).toEqual({
      'page.title': 'Accueil',
      'Save "it"': 'Enregistrer "ça"\n',
      'bare_key': 'Bare value',
      'unicode': 'é \\ %@ %1$@',
      'tight': 'x',
    })
    expect([
      ...descriptions!.values(),
    ]).toEqual(['Title of the page', 'Button'])
  })

  it('reads \\U as four hex digits, and a character past U+FFFF as a surrogate pair', () => {
    expect(format.parse('"a" = "\\U00e9\\U0041BC \\UD83D\\UDE00";', ctx).tree).toEqual({ a: '\u00E9ABC \u{1F600}' })
    expect(format.parse('"a" = "\\U0010FFFF";', ctx).tree).toEqual({ a: '\u0010FFFF' })
  })

  it('keeps a file header and a comment after an entry apart from the next entry', () => {
    const text = `/*\n  Localizable.strings\n  App\n*/\n\n"first" = "First"; // after first\n"second" = "Second";\n`
    const { descriptions } = format.parse(text, ctx)
    expect(descriptions!.size).toBe(0)
    expect(edit(text, [
      {
        type: 'delete',
        path: ['first'],
      },
    ])).toBe(`/*\n  Localizable.strings\n  App\n*/\n\n"second" = "Second";\n`)
  })

  it('reports a broken file', () => {
    expect(() => format.parse('"a" = "b"', ctx)).toThrow()
    expect(() => format.parse('"a" "b";', ctx)).toThrow()
    expect(() => format.parse('"a" = "b', ctx)).toThrow()
    expect(() => format.parse('/* open', ctx)).toThrow()
  })

  it('writes in place and round-trips', () => {
    const value = 'A "q" \\ \n end'
    const next = edit(source, [
      {
        type: 'set',
        path: ['page.title'],
        value,
      },
    ])
    expect(format.parse(next, ctx).tree['page.title']).toBe(value)
    expect(next.replace(/"page\.title" = ".*";/, '"page.title" = "Accueil";')).toBe(source)
    expect(edit(source, [
      {
        type: 'set',
        path: ['bare_key'],
        value: 'x',
      },
    ])).toContain('bare_key = "x";')
  })

  it('adds at the end, and removes an entry with its comment', () => {
    const next = edit(source, [
      {
        type: 'set',
        path: ['new "key"'],
        value: 'New',
      },
      {
        type: 'delete',
        path: ['page.title'],
      },
    ])
    expect(next).toContain('"new \\"key\\"" = "New";\n')
    expect(next).not.toContain('Title of the page')
    expect(next).not.toContain('Accueil')
    expect(next).toContain('// Button')
  })

  it('serializes what it reads', () => {
    const tree = { 'a b': 'c "d"', 'e': 'f\ng' }
    expect(format.parse(format.serialize!(tree, ctx), ctx).tree).toEqual(tree)
  })
})

describe('apple-strings preset', () => {
  const files = {
    'App/en.lproj/Localizable.strings': '"Hello, world" = "Hello, world";\n"welcome.title" = "Welcome %@";\n"unused" = "U";\n"view.title" = "V";\n"button" = "B";\n"helper" = "H";\n"resource" = "R";\n"objc" = "O";\n',
    'App/en.lproj/Settings.strings': '"theme" = "Theme";\n"table" = "T";\n"from.table" = "F";\n',
    'App/fr.lproj/Localizable.strings': '"Hello, world" = "Bonjour";\n',
    'App/zh-Hans.lproj/Localizable.strings': '"Hello, world" = "你好";\n',
    'App/Base.lproj/Main.strings': '"main.title" = "Main";\n',
    'App/ContentView.swift': [
      'let a = NSLocalizedString("Hello, world", comment: "")',
      'let b = NSLocalizedString("theme", tableName: "Settings", comment: "")',
      'let c = String(localized: "welcome.title")',
      'let d = String(localized: "table", table: "Settings")',
      'let e = LocalizedStringResource("resource")',
      'var body: some View { Text("view.title"); Button("button") { }; Text(verbatim: "not.a.key"); foo.Text("nope.a") }',
      'let f = "helper".localized',
      'let g = NSLocalizedString("\\(x) built", comment: "")',
      'let h = NSLocalizedString("missing.key", comment: "")',
    ].join('\n'),
    'App/Legacy.m': 'NSString *a = NSLocalizedString(@"objc", @"");\nNSString *b = NSLocalizedStringFromTable(@"from.table", @"Settings", @"");',
  }

  it('finds locales and tables, and usages in Swift, SwiftUI and Objective-C', async () => {
    const { project } = await createTestProject(files, {
      presets: [
        appleStrings(),
      ],
    })
    expect([...project.locales].sort()).toEqual(['en', 'fr', 'zh-Hans'])
    expect(project.usages().map(m => m.usage.key).sort()).toEqual([
      'Localizable:Hello, world',
      'Localizable:button',
      'Localizable:helper',
      'Localizable:missing.key',
      'Localizable:objc',
      'Localizable:resource',
      'Localizable:view.title',
      'Localizable:welcome.title',
      'Settings:from.table',
      'Settings:table',
      'Settings:theme',
    ])
    expect(project.analyze().unused).toEqual(['Localizable:unused', 'Main:main.title'])
  })

  it('creates a new locale in its .lproj folder', async () => {
    const { project } = await createTestProject(files, {
      presets: [
        appleStrings(),
      ],
    })
    await project.apply(project.plan([
      {
        type: 'set',
        key: project.parseKey('Localizable:Hello, world'),
        locale: 'de',
        value: 'Hallo',
      },
    ]))
    expect(project.text('App/de.lproj/Localizable.strings')).toBe('"Hello, world" = "Hallo";\n')
  })
})

const catalogText = `{
  "sourceLanguage" : "en",
  "strings" : {
    "Hello" : {
      "comment" : "A greeting",
      "localizations" : {
        "fr" : {
          "stringUnit" : {
            "state" : "translated",
            "value" : "Bonjour"
          }
        }
      }
    },
    "items %lld" : {
      "localizations" : {
        "en" : {
          "variations" : {
            "plural" : {
              "one" : {
                "stringUnit" : {
                  "state" : "translated",
                  "value" : "%lld item"
                }
              },
              "other" : {
                "stringUnit" : {
                  "state" : "translated",
                  "value" : "%lld items"
                }
              }
            }
          }
        }
      }
    },
    "OK" : {
      "shouldTranslate" : false
    },
    "title.text" : {
      "localizations" : {
        "en" : {
          "stringUnit" : {
            "state" : "translated",
            "value" : "The title"
          }
        },
        "fr" : {
          "stringUnit" : {
            "state" : "needs_review",
            "value" : "Le titre"
          }
        }
      }
    }
  },
  "version" : "1.0"
}
`

describe('xcstrings format', () => {
  const format = xcstrings().formats![0]!
  const en = { ...ctx, locale: 'en', path: 'Localizable.xcstrings' }
  const fr = { ...ctx, locale: 'fr', path: 'Localizable.xcstrings' }
  const edit = (ops: MessageOp[], where = fr): string => applyTextEdits(catalogText, format.edit!(catalogText, ops, where))

  it('reads one locale at a time, a key as its own source text, plurals and comments', () => {
    expect(format.parse(catalogText, en).tree).toEqual({
      'Hello': 'Hello',
      'items %lld.one': '%lld item',
      'items %lld.other': '%lld items',
      'title.text': 'The title',
    })
    const french = format.parse(catalogText, fr)
    expect(french.tree).toEqual({ 'Hello': 'Bonjour', 'title.text': 'Le titre' })
    expect([
      ...french.descriptions!.values(),
    ]).toEqual(['A greeting'])
  })

  it('points at the value, and at the key inside its quotes, in the source only', () => {
    const range = format.parse(catalogText, en).ranges!.get(pathId(['title.text']))!
    expect(catalogText.slice(range.value.start, range.value.end)).toBe('"The title"')
    expect(catalogText.slice(range.key.start, range.key.end)).toBe('title.text')
    // The key is shared, so a rename in place happens once: in the source.
    expect(format.parse(catalogText, fr).ranges!.size).toBe(0)
  })

  it('reads, sets and removes device variations', () => {
    const text = `{
  "sourceLanguage" : "en",
  "strings" : {
    "Save" : {
      "localizations" : {
        "en" : {
          "variations" : {
            "device" : {
              "iphone" : {
                "stringUnit" : {
                  "state" : "translated",
                  "value" : "Tap to save"
                }
              },
              "other" : {
                "stringUnit" : {
                  "state" : "translated",
                  "value" : "Click to save"
                }
              }
            }
          }
        }
      }
    }
  },
  "version" : "1.0"
}
`
    const where = { ...en, path: 'Device.xcstrings' }
    expect(format.parse(text, where).tree).toEqual({ 'Save.device.iphone': 'Tap to save', 'Save.device.other': 'Click to save' })
    const set = applyTextEdits(text, format.edit!(text, [
      {
        type: 'set',
        path: ['Save.device.iphone'],
        value: 'Touch to save',
      },
    ], where))
    expect(set).toBe(text.replace('Tap to save', 'Touch to save'))
    const removed = JSON.parse(applyTextEdits(text, format.edit!(text, [
      {
        type: 'delete',
        path: ['Save.device.iphone'],
      },
    ], where)))
    expect(Object.keys(removed.strings)).toEqual(['Save'])
    expect(removed.strings.Save.localizations.en.variations.device).toEqual({
      other: {
        stringUnit: { state: 'translated', value: 'Click to save' },
      },
    })
  })

  it('gives a comment only to its own key', () => {
    const text = JSON.stringify({
      sourceLanguage: 'en',
      strings: {
        'Save.As': {},
        'Save': { comment: 'Saves the file' },
      },
    })
    const { descriptions } = format.parse(text, en)
    expect([
      ...descriptions!.entries(),
    ]).toEqual([
      [
        pathId(['Save']),
        'Saves the file',
      ],
    ])
  })

  it('keeps Xcode\'s layout, so a write changes only what it must', () => {
    expect(edit([
      {
        type: 'set',
        path: ['Hello'],
        value: 'Salut',
      },
    ])).toBe(catalogText.replace('"Bonjour"', '"Salut"'))
  })

  it('adds a locale, marks it translated, and adds keys in order', () => {
    const next = edit([
      {
        type: 'set',
        path: ['items %lld.few'],
        value: '%lld few',
      },
    ], { ...fr, locale: 'pl' })
    expect(JSON.parse(next).strings['items %lld'].localizations.pl.variations.plural.few.stringUnit).toEqual({ state: 'translated', value: '%lld few' })
    const added = JSON.parse(edit([
      {
        type: 'set',
        path: ['Zed'],
        value: 'Z',
      },
    ]))
    expect(Object.keys(added.strings)).toEqual([
      'Hello',
      'items %lld',
      'OK',
      'title.text',
      'Zed',
    ])
    expect(added.strings.Zed.localizations.fr.stringUnit.state).toBe('translated')
  })

  it('removes a translation, and a key with its last source text', () => {
    expect(JSON.parse(edit([
      {
        type: 'delete',
        path: ['Hello'],
      },
    ])).strings.Hello).toEqual({ comment: 'A greeting' })
    const none = JSON.parse(edit([
      {
        type: 'delete',
        path: ['items %lld.one'],
      },
      {
        type: 'delete',
        path: ['items %lld.other'],
      },
    ], en))
    expect(none.strings['items %lld']).toBeUndefined()
  })

  it('writes a new catalog that reads back', () => {
    const tree = { 'Hello': 'Hello', 'n %lld.one': '%lld n', 'n %lld.other': '%lld ns' }
    expect(format.parse(format.serialize!(tree, en), en).tree).toEqual(tree)
  })

  it('reports a file that is not a catalog', () => {
    expect(() => format.parse('nope', en)).toThrow()
    expect(() => format.parse('{"a":1}', en)).toThrow()
  })
})

describe('stringsdict format', () => {
  const format = stringsdict().formats![0]!
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>items</key>
	<dict>
		<key>NSStringLocalizedFormatKey</key>
		<string>%#@count@</string>
		<key>count</key>
		<dict>
			<key>NSStringFormatSpecTypeKey</key>
			<string>NSStringPluralRuleType</string>
			<key>NSStringFormatValueTypeKey</key>
			<string>d</string>
			<key>one</key>
			<string>%d item &amp; more</string>
			<key>other</key>
			<string>%d items</string>
		</dict>
	</dict>
	<key>two</key>
	<dict>
		<key>NSStringLocalizedFormatKey</key>
		<string>%#@a@ %#@b@</string>
		<key>a</key>
		<dict>
			<key>one</key>
			<string>A</string>
		</dict>
		<key>b</key>
		<dict>
			<key>other</key>
			<string>B</string>
		</dict>
	</dict>
</dict>
</plist>
`
  const edit = (ops: MessageOp[]): string => applyTextEdits(source, format.edit!(source, ops, ctx))

  it('reads quantities, and variables when there are several', () => {
    expect(format.parse(source, ctx).tree).toEqual({
      'items.one': '%d item & more',
      'items.other': '%d items',
      'two.a.one': 'A',
      'two.b.other': 'B',
    })
  })

  it('writes in place, and adds a quantity in its dict', () => {
    expect(edit([
      {
        type: 'set',
        path: ['items.one'],
        value: 'x & y',
      },
    ])).toBe(source.replace('%d item &amp; more', 'x &amp; y'))
    const next = edit([
      {
        type: 'set',
        path: ['items.few'],
        value: '%d few',
      },
    ])
    expect(format.parse(next, ctx).tree).toMatchObject({ 'items.few': '%d few', 'items.one': '%d item & more' })
    expect(next).toContain('\t\t\t<key>few</key>\n\t\t\t<string>%d few</string>\n\t\t</dict>')
  })

  it('adds a new message, and removes a quantity and a whole message', () => {
    const added = edit([
      {
        type: 'set',
        path: ['cats.one'],
        value: '%d cat',
      },
    ])
    expect(format.parse(added, ctx).tree).toMatchObject({ 'cats.one': '%d cat', 'items.other': '%d items' })
    const removed = edit([
      {
        type: 'delete',
        path: ['items.one'],
      },
    ])
    expect(format.parse(removed, ctx).tree['items.one']).toBeUndefined()
    const gone = edit([
      {
        type: 'delete',
        path: ['items.one'],
      },
      {
        type: 'delete',
        path: ['items.other'],
      },
    ])
    expect(gone).not.toContain('<key>items</key>')
    expect(format.parse(gone, ctx).tree).toEqual({ 'two.a.one': 'A', 'two.b.other': 'B' })
  })

  it('writes a new file that reads back, and reports a broken one', () => {
    expect(format.parse(format.serialize!({ 'a.one': 'x', 'b.other': 'y' }, ctx), ctx).tree).toEqual({ 'a.one': 'x', 'b.other': 'y' })
    expect(() => format.parse('<nope/>', ctx)).toThrow()
  })

  it('refuses a message that is not a plural form, rather than changing its key', () => {
    expect(() => format.serialize!({ title: 'x' }, ctx)).toThrow(expect.objectContaining({ code: 'X18N4008' }))
    expect(() => edit([
      {
        type: 'set',
        path: ['cats.lots'],
        value: 'x',
      },
    ])).toThrow(expect.objectContaining({ code: 'X18N4008' }))
  })

  it('escapes a quantity it adds', () => {
    const next = edit([
      {
        type: 'set',
        path: ['items.a&b'],
        value: 'x',
      },
    ])
    expect(next).toContain('<key>a&amp;b</key>')
    expect(format.parse(next, ctx).tree['items.a&b']).toBe('x')
  })

  it('adds a key with more segments as its own message, not as a quantity of a shorter one', () => {
    const next = edit([
      {
        type: 'set',
        path: ['items.selected.one'],
        value: '%d selected',
      },
    ])
    expect(next).toContain('<key>items.selected</key>')
    expect(format.parse(next, ctx).tree).toEqual({
      'items.one': '%d item & more',
      'items.other': '%d items',
      'items.selected.one': '%d selected',
      'two.a.one': 'A',
      'two.b.other': 'B',
    })
  })
})

describe('apple-strings preset with catalogs', () => {
  const files = {
    'App/Localizable.xcstrings': catalogText,
    'App/en.lproj/Plurals.stringsdict': '<plist version="1.0"><dict><key>cats</key><dict><key>NSStringLocalizedFormatKey</key><string>%#@n@</string><key>n</key><dict><key>other</key><string>%d cats</string></dict></dict></dict></plist>\n',
    'App/View.swift': [
      'Text("Hello")',
      'String(localized: "title.text")',
      'String(localized: "items \\(count)")',
      'Text("OK")',
      'String(localized: "cats", table: "Plurals")',
      'String(localized: "nope")',
    ].join('\n'),
  }

  it('reads every locale of a catalog, with usages, plurals and never-translated keys', async () => {
    const { project } = await createTestProject(files, {
      presets: [
        appleStrings(),
      ],
      sourceLocale: 'en',
    })
    expect([...project.locales].sort()).toEqual(['en', 'fr'])
    expect(project.message(project.parseKey('Localizable:Hello'), 'fr')?.value).toBe('Bonjour')
    expect(project.message(project.parseKey('Localizable:Hello'), 'en')?.value).toBe('Hello')
    expect(project.usages().filter(m => m.usage.dynamic === false).map(m => m.usage.key).sort()).toEqual([
      'Localizable:Hello',
      'Localizable:nope',
      'Localizable:title.text',
      'Plurals:cats',
    ])
    expect(project.analyze().unused).toEqual([])
  })

  it('adds a language listed in locales to a catalog', async () => {
    const { project } = await createTestProject(files, {
      presets: [
        appleStrings(),
      ],
      sourceLocale: 'en',
      locales: ['en', 'fr', 'de'],
    })
    await project.apply(project.plan([
      {
        type: 'set',
        key: project.parseKey('Localizable:Hello'),
        locale: 'de',
        value: 'Hallo',
      },
    ]))
    expect(JSON.parse(project.text('App/Localizable.xcstrings')!).strings.Hello.localizations.de.stringUnit.value).toBe('Hallo')
  })

  it('writes two locales of one catalog in one plan, leaving the rest as it was', async () => {
    const { project } = await createTestProject(files, {
      presets: [
        appleStrings(),
      ],
      sourceLocale: 'en',
    })
    await project.apply(project.plan([
      {
        type: 'set',
        key: project.parseKey('Localizable:Hello'),
        locale: 'fr',
        value: 'Salut',
      },
      {
        type: 'set',
        key: project.parseKey('Localizable:title.text'),
        locale: 'en',
        value: 'New title',
      },
    ]))
    expect(project.text('App/Localizable.xcstrings')).toBe(catalogText.replace('"Bonjour"', '"Salut"').replace('"The title"', '"New title"'))
    expect(project.message(project.parseKey('Localizable:Hello'), 'fr')?.value).toBe('Salut')
    expect(project.message(project.parseKey('Localizable:title.text'), 'en')?.value).toBe('New title')
  })

  it('writes the same key in several locales of one catalog in one plan', async () => {
    // Xcode writes `\/`: a write leaves what it doesn't change as it was.
    const text = catalogText.replace('"Le titre"', '"Le\\/titre"')
    const { project } = await createTestProject({ ...files, 'App/Localizable.xcstrings': text }, {
      presets: [
        appleStrings(),
      ],
      sourceLocale: 'en',
      locales: ['en', 'fr', 'de'],
    })
    await project.apply(project.plan([
      {
        type: 'set',
        key: project.parseKey('Localizable:Hello'),
        locale: 'de',
        value: 'Hallo',
      },
      {
        type: 'set',
        key: project.parseKey('Localizable:Hello'),
        locale: 'fr',
        value: 'Salut',
      },
      {
        type: 'set',
        key: project.parseKey('Localizable:Zed'),
        locale: 'en',
        value: 'Z',
      },
    ]))
    expect(project.text('App/Localizable.xcstrings')).toContain('"Le\\/titre"')
    const catalog = JSON.parse(project.text('App/Localizable.xcstrings')!)
    expect(catalog.strings.Hello).toEqual({
      comment: 'A greeting',
      localizations: {
        de: {
          stringUnit: { state: 'translated', value: 'Hallo' },
        },
        fr: {
          stringUnit: { state: 'translated', value: 'Salut' },
        },
      },
    })
    expect(catalog.strings.Zed.localizations.en.stringUnit.value).toBe('Z')
    expect(project.message(project.parseKey('Localizable:Hello'), 'de')?.value).toBe('Hallo')
  })

  it('renames a key once for every locale of a catalog, in place or not', async () => {
    const { project } = await createTestProject(files, {
      presets: [
        appleStrings(),
      ],
      sourceLocale: 'en',
    })
    await project.apply(project.plan([
      {
        type: 'rename',
        from: project.parseKey('Localizable:Hello'),
        to: project.parseKey('Localizable:Greeting'),
        usages: false,
      },
    ]))
    // `Hello` had no source text, so it keeps its text under the new key.
    expect(project.text('App/Localizable.xcstrings')).toBe(catalogText.replace('"Hello" :', '"Greeting" :').replace(`      "localizations" : {
        "fr" : {
          "stringUnit" : {
            "state" : "translated",
            "value" : "Bonjour"`, `      "localizations" : {
        "en" : {
          "stringUnit" : {
            "state" : "translated",
            "value" : "Hello"
          }
        },
        "fr" : {
          "stringUnit" : {
            "state" : "translated",
            "value" : "Bonjour"`))
    await project.apply(project.plan([
      {
        type: 'rename',
        from: project.parseKey('Localizable:title.text'),
        to: project.parseKey('Localizable:The title text'),
        usages: false,
      },
      {
        type: 'rename',
        from: project.parseKey('Localizable:items %lld.one'),
        to: project.parseKey('Localizable:%lld things.one'),
        usages: false,
      },
      {
        type: 'rename',
        from: project.parseKey('Localizable:items %lld.other'),
        to: project.parseKey('Localizable:%lld things.other'),
        usages: false,
      },
    ]))
    const catalog = JSON.parse(project.text('App/Localizable.xcstrings')!)
    expect(Object.keys(catalog.strings).sort()).toEqual([
      '%lld things',
      'Greeting',
      'OK',
      'The title text',
    ])
    expect(catalog.strings['The title text'].localizations).toEqual({
      en: {
        stringUnit: { state: 'translated', value: 'The title' },
      },
      fr: {
        stringUnit: { state: 'needs_review', value: 'Le titre' },
      },
    })
    expect(catalog.strings['%lld things'].localizations.en.variations.plural.other.stringUnit.value).toBe('%lld items')
    expect(project.message(project.parseKey('Localizable:Greeting'), 'fr')?.value).toBe('Bonjour')
    expect(project.message(project.parseKey('Localizable:Greeting'), 'en')?.value).toBe('Hello')
  })

  it('reports a broken catalog without losing the other files', async () => {
    const { project } = await createTestProject({
      ...files,
      'App/Broken.xcstrings': '{ "strings": ',
    }, {
      presets: [
        appleStrings(),
      ],
      sourceLocale: 'en',
    })
    expect(project.message(project.parseKey('Localizable:Hello'), 'fr')?.value).toBe('Bonjour')
    expect(project.message(project.parseKey('Plurals:cats.other'), 'en')?.value).toBe('%d cats')
    expect(project.explain().errors.map(e => e.path)).toEqual(['App/Broken.xcstrings'])
  })
})
