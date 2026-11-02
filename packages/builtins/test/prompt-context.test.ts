import { relatedLocales, renderPrompt } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { arb } from '../src/formats/arb'
import { po } from '../src/formats/po'
import { resx } from '../src/formats/resx'
import { xliff } from '../src/formats/xliff'
import { xmb } from '../src/formats/xmb'
import { createTestProject, json } from './_utils'

function ctx(path: string) {
  return {
    path,
    locale: 'en',
    namespace: undefined,
    indent: undefined,
  }
}
function descriptions(plugin: ReturnType<typeof po>, path: string, text: string): Record<string, string> {
  return Object.fromEntries(plugin.formats![0]!.parse(text, ctx(path)).descriptions ?? [])
}

describe('message descriptions from formats', () => {
  it('arB: the description of `@key` metadata', () => {
    const text = json({
      '@@locale': 'en',
      'hello': 'Hello',
      '@hello': { description: 'Greets the user on the home page' },
      'bye': 'Bye',
      '@bye': { placeholders: {} },
    })
    expect(descriptions(arb(), 'l10n/app_en.arb', text)).toEqual({ hello: 'Greets the user on the home page' })
  })

  it('gettext: extracted and translator comments, not references or flags', () => {
    const text = [
      'msgid ""',
      'msgstr ""',
      '',
      '# Shown in the menu',
      '#. The verb, not the noun',
      '#: src/App.vue:3',
      '#, fuzzy',
      'msgid "Open"',
      'msgstr "Öffnen"',
      '',
      'msgid "Close"',
      'msgstr ""',
      '',
    ].join('\n')
    expect(descriptions(po(), 'de.po', text)).toEqual({ Open: 'Shown in the menu\nThe verb, not the noun' })
  })

  it('xLIFF 1.2 and 2.0: description and meaning notes, not locations', () => {
    const v12 = `<xliff version="1.2"><file target-language="de"><body>
  <trans-unit id="a"><source>Open</source><target>Öffnen</target>
    <context-group purpose="location"><context context-type="sourcefile">app.ts</context></context-group>
    <note priority="1" from="description">Button that opens a file</note>
    <note priority="1" from="meaning">verb</note>
  </trans-unit>
  <trans-unit id="b"><source>B</source><target>B</target></trans-unit>
</body></file></xliff>`
    expect(descriptions(xliff(), 'messages.de.xlf', v12)).toEqual({ a: 'Button that opens a file\nMeaning: verb' })
    const v20 = `<xliff version="2.0" srcLang="en" trgLang="de"><file id="ngi18n">
  <unit id="a"><notes><note category="location">app.ts:3</note><note category="description">Page title &amp; tab name</note></notes>
    <segment><source>Home</source><target>Start</target></segment></unit>
</file></xliff>`
    expect(descriptions(xliff(), 'messages.de.xlf', v20)).toEqual({ a: 'Page title & tab name' })
  })

  it('xMB: the desc and meaning attributes', () => {
    const text = '<messagebundle>\n  <msg id="a" desc="Greeting" meaning="home">Hello</msg>\n  <msg id="b">Bye</msg>\n</messagebundle>\n'
    expect(descriptions(xmb(), 'messages.xmb', text)).toEqual({ a: 'Greeting\nMeaning: home' })
  })

  it('rESX: the comment of a data element', () => {
    const text = '<root>\n  <data name="a" xml:space="preserve">\n    <value>Open</value>\n    <comment>Menu entry &lt;File&gt;</comment>\n  </data>\n  <data name="b"><value>B</value></data>\n</root>\n'
    expect(descriptions(resx(), 'Strings.resx', text)).toEqual({ a: 'Menu entry <File>' })
  })
})

describe('more context in the translate prompt', () => {
  it('chrome extensions: the description beside the message', async () => {
    const { project } = await createTestProject({
      'manifest.json': json({ default_locale: 'en' }),
      '_locales/en/messages.json': json({
        appName: { message: 'Notes', description: 'Name of the extension in the store' },
        hello: { message: 'Hello' },
      }),
      '_locales/de/messages.json': json({}),
    })
    expect(project.message('appName', 'en')?.description).toBe('Name of the extension in the store')
    const data = project.prompt('translate', 'de', { context: false })
    expect(data.items.map(i => [i.key, i.description])).toEqual([
      ['appName', 'Name of the extension in the store'],
      ['hello', undefined],
    ])
    expect(data.rules).toContain('A description tells what a message means or where it appears: follow it, and do not translate it.')
    expect(renderPrompt(data)).toContain('- Description: "Name of the extension in the store"')
  })

  it('react-intl: the description written beside the id in code', async () => {
    const { project } = await createTestProject({
      'package.json': json({
        dependencies: { 'react-intl': '*' },
      }),
      'lang/en.json': json({ 'app.title': 'Notes', 'app.save': 'Save', 'app.open': 'Open' }),
      'lang/de.json': json({}),
      'src/App.tsx': [
        `const m = defineMessages({ title: { id: 'app.title', description: 'Window title' }, other: { id: 'app.open' } })`,
        `intl.formatMessage({ id: 'app.save', description: 'Saves the note' })`,
        `const el = <FormattedMessage id="app.open" description="Opens a note" />`,
      ].join('\n'),
    })
    expect(project.usages().map(({ usage }) => [usage.key, usage.description])).toEqual([
      ['app.title', 'Window title'],
      ['app.open', undefined],
      ['app.save', 'Saves the note'],
      ['app.open', 'Opens a note'],
    ])
    expect(project.prompt('translate', 'de', { context: false }).items.map(i => [i.key, i.description])).toEqual([
      ['app.open', 'Opens a note'],
      ['app.save', 'Saves the note'],
      ['app.title', 'Window title'],
    ])
  })

  it('shows the values of related locales, nearest first, and leaves copies of the source out', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({
        bus: 'Bus',
        train: 'Train',
        ok: 'OK',
        fresh: 'New',
      }),
      'locales/pt.json': json({ bus: 'Autocarro', train: 'Comboio', ok: 'OK' }),
      'locales/pt-PT.json': json({ bus: 'Autocarro' }),
      'locales/pt-BR.json': json({}),
      'locales/es.json': json({ bus: 'Autobús' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    const data = project.prompt('translate', 'pt-BR', { context: false })
    expect(data.items.map(i => [i.key, i.related])).toEqual([
      [
        'bus',
        [
          { locale: 'pt', value: 'Autocarro' },
          { locale: 'pt-PT', value: 'Autocarro' },
        ],
      ],
      ['fresh', undefined],
      ['ok', undefined],
      [
        'train',
        [
          { locale: 'pt', value: 'Comboio' },
        ],
      ],
    ])
    expect(data.rules).toContain('Values in related locales are references: keep what fits pt-BR, and change the spelling, words and forms that differ.')
    expect(renderPrompt(data)).toContain('- Source: "Bus"\n- In pt: "Autocarro"\n- In pt-PT: "Autocarro"\n')
    expect(project.prompt('translate', 'pt-BR', { related: false }).items.every(i => i.related === undefined)).toBe(true)
    expect(project.prompt('translate', 'pt-BR', {
      related: ['es'],
      keys: 'bus',
    }).items[0]!.related).toEqual([
      { locale: 'es', value: 'Autobús' },
    ])
    expect(project.prompt('translate', 'pt-BR', { related: false }).rules.join('\n')).not.toContain('related locales')
  })

  it('cuts long descriptions and related values', async () => {
    const long = 'x'.repeat(1000)
    const { project } = await createTestProject({
      'locales/en.xlf': `<xliff version="1.2"><file><body><trans-unit id="a"><source>A</source><note>${long}</note></trans-unit></body></file></xliff>`,
      'locales/fr.xlf': `<xliff version="1.2"><file target-language="fr"><body><trans-unit id="a"><source>A</source><target>${long}</target></trans-unit></body></file></xliff>`,
      'locales/fr-CA.xlf': `<xliff version="1.2"><file target-language="fr-CA"><body></body></file></xliff>`,
    }, {
      resources: [
        { pattern: 'locales/{locale}.xlf' },
      ],
    })
    const [item] = project.prompt('translate', 'fr-CA', { context: false }).items
    expect(item!.description).toHaveLength(300)
    expect(item!.description!.endsWith('…')).toBe(true)
    expect(item!.related![0]!.value).toHaveLength(300)
  })
})

describe('relatedLocales', () => {
  const locales = [
    'en',
    'pt',
    'pt-BR',
    'pt-PT',
    'pt-AO',
    'es',
    'zh-Hant',
    'zh-Hant-TW',
    'zh-Hant-HK',
    'zh-Hans',
  ]
  it('puts the fallback chain first, then the locales sharing more subtags, then the shorter codes', () => {
    expect(relatedLocales('pt-BR', locales, 'en', {})).toEqual(['pt', 'pt-AO', 'pt-PT'])
    expect(relatedLocales('pt-BR', locales, 'en', { 'pt-BR': 'pt-PT' })).toEqual(['pt-PT', 'pt', 'pt-AO'])
    expect(relatedLocales('pt', locales, 'en', {})).toEqual(['pt-AO', 'pt-BR', 'pt-PT'])
    expect(relatedLocales('zh-Hant-TW', locales, 'en', {})).toEqual(['zh-Hant', 'zh-Hant-HK', 'zh-Hans'])
    expect(relatedLocales('es', locales, 'en', {})).toEqual([])
  })

  it('never lists the source locale or the target, and follows explicit fallbacks to other languages', () => {
    expect(relatedLocales('en-GB', ['en', 'en-GB', 'en-US'], 'en', { 'en-GB': 'en' })).toEqual(['en-US'])
    expect(relatedLocales('ca', ['en', 'ca', 'es'], 'en', { ca: 'es' })).toEqual(['es'])
    expect(relatedLocales('pt_BR', ['en', 'pt', 'pt_BR'], 'en', {})).toEqual(['pt'])
  })
})
