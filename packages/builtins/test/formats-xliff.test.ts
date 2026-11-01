import type { MessageOp } from '@x18n/core'
import { applyTextEdits, pathId } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { xliff } from '../src/formats/xliff'

const format = xliff().formats![0]!
const ctx = {
  path: 'src/locale/messages.tr.xlf',
  locale: 'tr',
  namespace: undefined,
  indent: undefined,
}
const edit = (text: string, ops: MessageOp[]): string => applyTextEdits(text, format.edit!(text, ops, ctx))

const source12 = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en-US" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="8889534073701065911" datatype="html">
        <source>Welcome, <x id="INTERPOLATION" equiv-text="{{ name }}"/>!</source>
        <note priority="1" from="meaning">site intro</note>
      </trans-unit>
      <trans-unit id="home.intro" datatype="html">
        <source>Read the <x id="START_LINK" ctype="x-a" equiv-text="&lt;a href=&quot;/docs&quot;&gt;"/>docs<x id="CLOSE_LINK" ctype="x-a" equiv-text="&lt;/a&gt;"/> &amp; more</source>
      </trans-unit>
    </body>
  </file>
</xliff>
`

const translated12 = source12
  .replace('source-language="en-US"', 'source-language="en-US" target-language="tr"')
  .replace('equiv-text="{{ name }}"/>!</source>', 'equiv-text="{{ name }}"/>!</source>\n        <target state="translated">Hoş geldin, <x id="INTERPOLATION" equiv-text="{{ name }}"/>!</target>')

const source20 = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="2.0" xmlns="urn:oasis:names:tc:xliff:document:2.0" srcLang="en-US" trgLang="tr">
  <file id="ngi18n" original="ng.template">
    <unit id="home.intro">
      <segment>
        <source>Read the <pc id="0" equivStart="START_LINK" equivEnd="CLOSE_LINK" type="link" dispStart="&lt;a&gt;" dispEnd="&lt;/a&gt;">docs</pc>, <ph id="1" equiv="INTERPOLATION" disp="{{ name }}"/></source>
      </segment>
    </unit>
  </file>
</xliff>
`

describe('xliff format', () => {
  it('reads an XLIFF 1.2 source file: placeholders as {$NAME}, entities decoded', () => {
    const { tree, ranges } = format.parse(source12, ctx)
    expect(tree).toEqual({
      '8889534073701065911': 'Welcome, {$INTERPOLATION}!',
      'home.intro': 'Read the {$START_LINK}docs{$CLOSE_LINK} & more',
    })
    const intro = ranges!.get(pathId(['home.intro']))!
    expect(source12.slice(intro.key.start, intro.key.end)).toBe('home.intro')
  })

  it('reads only targets in a translation file', () => {
    expect(format.parse(translated12, ctx).tree).toEqual({ '8889534073701065911': 'Hoş geldin, {$INTERPOLATION}!' })
  })

  it('reads target and segment states', () => {
    expect(format.parse(source12, ctx).states?.size).toBe(0)
    const states = (state: string): unknown => format.parse(translated12.replace('state="translated"', `state="${state}"`), ctx).states?.get(pathId(['8889534073701065911']))
    expect([
      states('translated'),
      states('needs-review-translation'),
      states('signed-off'),
      states('new'),
    ]).toEqual([
      'translated',
      'needs-review',
      'reviewed',
      undefined,
    ])
    const reviewed20 = source20.replace('<segment>', '<segment state="reviewed">').replace('</source>', '</source>\n        <target>Belgeler</target>')
    expect(format.parse(reviewed20, ctx).states?.get(pathId(['home.intro']))).toBe('reviewed')
  })

  it('writes targets with the placeholder markup of the source', () => {
    const next = edit(translated12, [
      {
        type: 'set',
        path: ['8889534073701065911'],
        value: 'Merhaba {$INTERPOLATION}',
      },
      {
        type: 'set',
        path: ['home.intro'],
        value: '{$START_LINK}Belgeleri{$CLOSE_LINK} oku & dahası',
      },
    ])
    expect(next).toContain('<target state="translated">Merhaba <x id="INTERPOLATION" equiv-text="{{ name }}"/></target>')
    expect(next).toContain(`docs<x id="CLOSE_LINK" ctype="x-a" equiv-text="&lt;/a&gt;"/> &amp; more</source>
        <target><x id="START_LINK" ctype="x-a" equiv-text="&lt;a href=&quot;/docs&quot;&gt;"/>Belgeleri<x id="CLOSE_LINK" ctype="x-a" equiv-text="&lt;/a&gt;"/> oku &amp; dahası</target>`)
    expect(format.parse(next, ctx).tree).toEqual({
      '8889534073701065911': 'Merhaba {$INTERPOLATION}',
      'home.intro': '{$START_LINK}Belgeleri{$CLOSE_LINK} oku & dahası',
    })
  })

  it('adds and deletes units', () => {
    const added = edit(translated12, [
      {
        type: 'set',
        path: ['new.key'],
        value: 'Yeni',
      },
    ])
    expect(added).toContain(`      </trans-unit>
      <trans-unit id="new.key" datatype="html">
        <target>Yeni</target>
      </trans-unit>
    </body>`)
    const removed = edit(added, [
      {
        type: 'delete',
        path: ['home.intro'],
      },
    ])
    expect(removed).not.toContain('home.intro')
    expect(format.parse(removed, ctx).tree).toEqual({ '8889534073701065911': 'Hoş geldin, {$INTERPOLATION}!', 'new.key': 'Yeni' })
  })

  it('reads and writes XLIFF 2.0, keeping <pc> pairs', () => {
    expect(format.parse(source20, ctx).tree).toEqual({})
    const next = edit(source20, [
      {
        type: 'set',
        path: ['home.intro'],
        value: '{$START_LINK}Belgeler{$CLOSE_LINK}, {$INTERPOLATION}',
      },
    ])
    expect(next).toContain('<target><pc id="0" equivStart="START_LINK" equivEnd="CLOSE_LINK" type="link" dispStart="&lt;a&gt;" dispEnd="&lt;/a&gt;">Belgeler</pc>, <ph id="1" equiv="INTERPOLATION" disp="{{ name }}"/></target>')
    expect(format.parse(next, ctx).tree).toEqual({ 'home.intro': '{$START_LINK}Belgeler{$CLOSE_LINK}, {$INTERPOLATION}' })
  })

  it('serializes a new XLIFF 1.2 translation file', () => {
    const text = format.serialize!({ 'a.b': 'x < {$PH}' }, ctx)
    expect(text).toContain('target-language="tr"')
    expect(format.parse(text, ctx).tree).toEqual({ 'a.b': 'x < {$PH}' })
  })
})
