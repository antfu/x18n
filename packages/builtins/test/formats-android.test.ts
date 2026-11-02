import type { Format, MessageOp } from '@x18n/core'
import { applyTextEdits } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { androidXml } from '../src/formats/android-xml'
import { androidStrings } from '../src/presets/android-strings'
import { createTestProject, json } from './_utils'

const ctx = {
  path: 'x',
  locale: 'fr',
  namespace: undefined,
  indent: undefined,
}

function editor(format: Format): (text: string, ops: MessageOp[]) => string {
  return (text, ops) => applyTextEdits(text, format.edit!(text, ops, ctx))
}

describe('android-xml format', () => {
  const format = androidXml().formats![0]!
  const edit = editor(format)
  const source = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name" translatable="false">My App</string>
    <!-- Greets the user -->
    <string name="hello">Hello %1$s</string>
    <string name="quote">It\\'s \\"here\\" \\u00e9 \\n \\@now \\\\ &amp; &lt;x&gt;</string>
    <string name="spaced">"  two  spaces  "</string>
    <string name="wrapped">
        one
        line
    </string>
    <string name="rich">Bold <b>word</b> here</string>
    <string name="data"><![CDATA[<a href=\\"x\\">link</a>]]></string>
    <string name="empty"/>
    <plurals name="items">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
    </plurals>
    <string-array name="days">
        <item>Mon</item>
        <item>Tue</item>
    </string-array>
    <string-array name="codes" translatable="false">
        <item>a</item>
    </string-array>
    <color name="ignored">#fff</color>
</resources>
`

  it('reads strings, plurals, arrays, escapes and markup', () => {
    const { tree, descriptions } = format.parse(source, ctx)
    expect(tree).toEqual({
      'hello': 'Hello %1$s',
      'quote': 'It\'s "here" é \n @now \\ & <x>',
      'spaced': '  two  spaces  ',
      'wrapped': 'one line',
      'rich': 'Bold <b>word</b> here',
      'data': '<a href="x">link</a>',
      'empty': '',
      'items.one': '%d item',
      'items.other': '%d items',
      'days.0': 'Mon',
      'days.1': 'Tue',
    })
    expect([
      ...descriptions!.values(),
    ]).toEqual(['Greets the user'])
  })

  it('points at the name and the value', () => {
    const { ranges } = format.parse(source, ctx)
    const range = [
      ...ranges!.values(),
    ][0]!
    expect(source.slice(range.key.start, range.key.end)).toBe('hello')
    expect(source.slice(range.value.start, range.value.end)).toBe('Hello %1$s')
  })

  it('writes in place, with Android escapes, and round-trips', () => {
    const value = 'It\'s "x" \n @a & <y> \\'
    const next = edit(source, [
      {
        type: 'set',
        path: ['hello'],
        value,
      },
    ])
    expect(next).toContain('<string name="hello">It\\\'s \\"x\\" \\n @a &amp; &lt;y&gt; \\\\</string>')
    expect(format.parse(next, ctx).tree.hello).toBe(value)
    expect(next.replace(/<string name="hello">.*<\/string>/, '<string name="hello">Hello %1$s</string>')).toBe(source)
  })

  it('escapes a leading @ and ?, and keeps space with quotes', () => {
    expect(edit(source, [
      {
        type: 'set',
        path: ['hello'],
        value: '@home',
      },
    ])).toContain('>\\@home<')
    expect(edit(source, [
      {
        type: 'set',
        path: ['hello'],
        value: '?why',
      },
    ])).toContain('>\\?why<')
    const next = edit(source, [
      {
        type: 'set',
        path: ['hello'],
        value: '  a  b ',
      },
    ])
    expect(format.parse(next, ctx).tree.hello).toBe('  a  b ')
  })

  it('keeps inline markup and CDATA', () => {
    const next = edit(source, [
      {
        type: 'set',
        path: ['rich'],
        value: 'Fett <b>Wort</b>',
      },
      {
        type: 'set',
        path: ['data'],
        value: '<a href="y">z</a>',
      },
      {
        type: 'set',
        path: ['empty'],
        value: 'Now',
      },
    ])
    expect(next).toContain('<string name="rich">Fett <b>Wort</b></string>')
    expect(next).toContain('<![CDATA[')
    expect(format.parse(next, ctx).tree.data).toBe('<a href="y">z</a>')
    expect(next).toContain('<string name="empty">Now</string>')
  })

  it('adds strings, plural items and array items where they belong', () => {
    const next = edit(source, [
      {
        type: 'set',
        path: ['added'],
        value: 'New',
      },
      {
        type: 'set',
        path: ['items.few'],
        value: '%d few',
      },
      {
        type: 'set',
        path: ['days.2'],
        value: 'Wed',
      },
      {
        type: 'set',
        path: ['cats.one'],
        value: '%d cat',
      },
    ])
    const { tree } = format.parse(next, ctx)
    expect(tree).toMatchObject({
      'added': 'New',
      'items.few': '%d few',
      'days.2': 'Wed',
      'cats.one': '%d cat',
    })
    expect(next).toContain('        <item quantity="few">%d few</item>\n    </plurals>')
    expect(next).toContain('    <string name="added">New</string>\n')
    expect(next.trimEnd().endsWith('</resources>')).toBe(true)
  })

  it('removes an entry on its line, and a group with its last item', () => {
    const next = edit(source, [
      {
        type: 'delete',
        path: ['hello'],
      },
      {
        type: 'delete',
        path: ['days.0'],
      },
      {
        type: 'delete',
        path: ['items.one'],
      },
      {
        type: 'delete',
        path: ['items.other'],
      },
    ])
    expect(next).not.toContain('name="hello"')
    expect(next).not.toContain('<plurals')
    expect(next).toContain('<item>Tue</item>')
    expect(next).toContain('app_name')
  })

  it('writes a new file that reads back, and fails on a file with no root', () => {
    const out = format.serialize!({ 'a': 'x', 'n.one': 'y' }, ctx)
    expect(format.parse(out, ctx).tree).toEqual({ 'a': 'x', 'n.one': 'y' })
    expect(() => edit('<nope/>', [
      {
        type: 'set',
        path: ['a'],
        value: 'x',
      },
    ])).toThrow()
  })
})

describe('android-strings preset', () => {
  const files = {
    'app/build.gradle.kts': '',
    'app/src/main/AndroidManifest.xml': '<manifest><application android:label="@string/app_name" /></manifest>',
    'app/src/main/res/values/strings.xml': '<resources>\n    <string name="app_name" translatable="false">App</string>\n    <string name="hello">Hello %s</string>\n    <string name="unused">U</string>\n    <string name="title">T</string>\n    <plurals name="items">\n        <item quantity="one">%d item</item>\n        <item quantity="other">%d items</item>\n    </plurals>\n    <string-array name="days">\n        <item>Mon</item>\n    </string-array>\n</resources>\n',
    'app/src/main/res/values-fr/strings.xml': '<resources>\n    <string name="hello">Bonjour %s</string>\n</resources>\n',
    'app/src/main/res/values-zh-rCN/strings.xml': '<resources>\n    <string name="hello">你好 %s</string>\n</resources>\n',
    'app/src/main/res/values-b+sr+Latn/strings.xml': '<resources>\n    <string name="hello">Zdravo %s</string>\n</resources>\n',
    'app/src/main/res/values-night/colors.xml': '<resources><color name="a">#000</color></resources>',
    'app/src/main/res/values-land/strings.xml': '<resources><string name="wide">W</string></resources>',
    'app/src/main/res/values/colors.xml': '<resources><color name="b">#000</color></resources>',
    'app/src/main/res/layout/main.xml': '<TextView android:text="@string/title" />',
    'app/src/main/java/App.kt': 'val a = getString(R.string.hello)\nval b = stringResource(R.string.nope)\nval c = resources.getQuantityString(R.plurals.items, 2)\nval d = R.array.days\nval e = R.string.app_name\nval f = R.drawable.icon',
  }

  it('finds locales from folders, usages, plurals and arrays', async () => {
    const { project } = await createTestProject(files, {
      presets: [
        androidStrings(),
      ],
    })
    expect([...project.locales].sort()).toEqual(['en', 'fr', 'sr-Latn', 'zh-CN'])
    expect(project.usages().map(m => m.usage.key).sort()).toEqual([
      'days',
      'hello',
      'items',
      'nope',
      'title',
    ])
    expect(project.message(project.parseKey('hello'), 'zh-CN')?.value).toBe('你好 %s')
    expect(project.analyze().unused).toEqual(['unused'])
  })

  it('creates a new locale in the Android folder name', async () => {
    const { project } = await createTestProject(files, {
      presets: [
        androidStrings(),
      ],
    })
    const plan = project.plan([
      {
        type: 'set',
        key: project.parseKey('hello'),
        locale: 'pt-BR',
        value: 'Olá %s',
      },
    ])
    await project.apply(plan)
    expect(project.text('app/src/main/res/values-pt-rBR/strings.xml')).toContain('Olá %s')
  })

  it('is not detected in a web or Flutter app with an android folder', async () => {
    const android = { 'android/app/src/main/AndroidManifest.xml': '<manifest/>', 'android/app/src/main/res/values/strings.xml': '<resources/>' }
    const web = await createTestProject({
      ...android,
      'package.json': json({}),
    })
    expect(web.project.explain().presets.find(p => p.name === 'android-strings')?.reason).not.toBe('detected')
    const native = await createTestProject({ 'app/src/main/AndroidManifest.xml': '<manifest/>', 'app/src/main/res/values/strings.xml': '<resources/>' })
    expect(native.project.explain().presets.find(p => p.name === 'android-strings')?.reason).toBe('detected')
  })
})
