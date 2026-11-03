import type { MessageOp } from '@x18n/core'
import { applyTextEdits, pathId } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { po } from '../src/formats/po'
import { createTestProject } from './_utils'

const format = po().formats![0]!
const ctx = {
  path: 'locales/de.po',
  locale: 'de',
  namespace: undefined,
  indent: undefined,
}
const edit = (text: string, ops: MessageOp[]): string => applyTextEdits(text, format.edit!(text, ops, ctx))

const source = `# Translation of app
msgid ""
msgstr ""
"Language: de\\n"

# A greeting
#: src/App.vue:3
#, fuzzy
msgid "Hello"
msgstr "Hallo"

msgctxt "menu"
msgid "Open"
msgstr "Öffnen"

msgid ""
"Line one\\n"
"line two"
msgstr ""
"Zeile eins\\n"
"Zeile zwei"

msgid "item"
msgid_plural "items"
msgstr[0] "Eintrag \\"x\\""
msgstr[1] "Einträge"
`

describe('po format', () => {
  it('parses messages, contexts, continuations and plurals, skipping the header', () => {
    const { tree, ranges } = format.parse(source, ctx)
    expect(tree).toEqual({
      'Hello': 'Hallo',
      'menu\u0004Open': 'Öffnen',
      'Line one\nline two': 'Zeile eins\nZeile zwei',
      'item': 'Eintrag "x"',
    })
    const hello = ranges!.get(pathId(['Hello']))!
    expect(source.slice(hello.key.start, hello.key.end)).toBe('Hello')
    expect(source.slice(hello.value.start, hello.value.end)).toBe('Hallo')
    const open = ranges!.get(pathId(['menu\u0004Open']))!
    expect(source.slice(open.key.start, open.key.end)).toBe('Open')
  })

  it('marks fuzzy entries for review', () => {
    const { states } = format.parse(source, ctx)
    expect([...states!]).toEqual([
      [
        pathId(['Hello']),
        'needs-review',
      ],
    ])
  })

  it('sets an existing msgstr in place', () => {
    expect(edit(source, [
      {
        type: 'set',
        path: ['Hello'],
        value: 'Servus "du"',
      },
    ])).toBe(source.replace('msgstr "Hallo"', 'msgstr "Servus \\"du\\""'))
    expect(edit(source, [
      {
        type: 'set',
        path: ['item'],
        value: 'Ding',
      },
    ])).toBe(source.replace('msgstr[0] "Eintrag \\"x\\""', 'msgstr[0] "Ding"'))
    expect(edit(source, [
      {
        type: 'set',
        path: ['Line one\nline two'],
        value: 'Eins\nZwei',
      },
    ]))
      .toBe(source.replace('msgstr ""\n"Zeile eins\\n"\n"Zeile zwei"', 'msgstr ""\n"Eins\\n"\n"Zwei"'))
  })

  it('appends new entries and removes entries with their comments', () => {
    expect(edit(source, [
      {
        type: 'set',
        path: ['ctx\u0004Bye'],
        value: 'Tschüss',
      },
    ])).toBe(`${source}\nmsgctxt "ctx"\nmsgid "Bye"\nmsgstr "Tschüss"\n`)
    const removed = edit(source, [
      {
        type: 'delete',
        path: ['Hello'],
      },
    ])
    expect(removed).not.toContain('A greeting')
    expect(removed).toContain('"Language: de\\n"\n\nmsgctxt "menu"')
    expect(edit(source, [
      {
        type: 'delete',
        path: ['item'],
      },
    ])).toBe(source.slice(0, source.indexOf('\nmsgid "item"')))
  })

  it('serializes with a header and round-trips', () => {
    const text = format.serialize!({ 'a': 'A "q"', 'multi': 'one\ntwo', 'c\u0004b': 'B' }, ctx)
    expect(text).toContain('"Language: de\\n"')
    expect(text).toContain('msgctxt "c"\nmsgid "b"\nmsgstr "B"\n')
    expect(format.parse(text, ctx).tree).toEqual({ 'a': 'A "q"', 'multi': 'one\ntwo', 'c\u0004b': 'B' })
  })

  it('reports syntax errors with a code', () => {
    expect(() => format.parse('msgid "a"\nmsgstr "b\n', ctx)).toThrow(expect.objectContaining({ code: 'X18N2002' }))
    expect(() => format.parse('msgid "a"\nbogus\n', ctx)).toThrow(expect.objectContaining({ code: 'X18N2002' }))
    expect(() => format.parse('msgid "a"\n', ctx)).toThrow(expect.objectContaining({ code: 'X18N2002' }))
  })

  it('works through a project', async () => {
    const { project, files } = await createTestProject({ 'locales/de.po': source }, {
      resources: [
        { pattern: 'locales/{locale}.po' },
      ],
    })
    expect(project.keys()).toContain('Hello')
    await project.apply(project.plan([
      {
        type: 'set',
        key: 'Hello',
        locale: 'de',
        value: 'Moin',
      },
    ]))
    expect(files.get('locales/de.po')).toBe(source.replace('"Hallo"', '"Moin"'))
  })
})
