import type { Project } from '@x18n/core'
import { renderPrompt } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { reactI18next } from '../src/presets/react-i18next'
import { vueI18n } from '../src/presets/vue-i18n'
import { createTestProject, json } from './_utils'

async function write(project: Project, ops: Parameters<Project['plan']>[0]): Promise<ReturnType<Project['plan']>> {
  const plan = project.plan(ops)
  const answers = Object.fromEntries(plan.decisions.map(d => [d.id, d.default]))
  await project.apply(plan, { answers })
  return plan
}

/** Every byte outside the edit ranges stays the same. */
function outsideEdits(before: string, plan: ReturnType<Project['plan']>, path: string): string[] {
  const change = plan.changes.find(c => c.path === path)
  if (!change || change.type !== 'edit')
    return [before]
  const sorted = [...change.edits].sort((a, b) => a.range.start - b.range.start)
  const parts: string[] = []
  let last = 0
  for (const edit of sorted) {
    parts.push(before.slice(last, edit.range.start))
    last = edit.range.end
  }
  parts.push(before.slice(last))
  return parts
}

describe('in-place edits', () => {
  it('jSON keeps layout, comments and other values (jsonc)', async () => {
    const before = '{\n    // header\n    "a": "A",\n    "nested": { "b": "B" },\n    "n": 3\n}\n'
    const { project, files } = await createTestProject({ 'locales/en.jsonc': before }, {
      resources: [
        { pattern: 'locales/{locale}.jsonc' },
      ],
    })
    const plan = await write(project, [
      {
        type: 'set',
        key: 'nested.b',
        locale: 'en',
        value: 'Bee',
      },
    ])
    const after = files.get('locales/en.jsonc')!
    expect(after).toBe('{\n    // header\n    "a": "A",\n    "nested": { "b": "Bee" },\n    "n": 3\n}\n')
    for (const part of outsideEdits(before, plan, 'locales/en.jsonc'))
      expect(after).toContain(part)
    expect(project.message('n', 'en')?.value).toBe(3)
  })

  it('yAML keeps comments and quote styles', async () => {
    const before = '# top\napp:\n  title: \'My App\' # keep\n  other: "x"\nlist: plain\n'
    const { project, files } = await createTestProject({ 'locales/en.yml': before }, {
      resources: [
        { pattern: 'locales/{locale}.yml' },
      ],
    })
    await write(project, [
      {
        type: 'set',
        key: 'app.title',
        locale: 'en',
        value: 'It\'s',
      },
    ])
    expect(files.get('locales/en.yml')).toBe('# top\napp:\n  title: \'It\'\'s\' # keep\n  other: "x"\nlist: plain\n')
    await write(project, [
      {
        type: 'set',
        key: 'app.added',
        locale: 'en',
        value: 'New',
      },
    ])
    expect(files.get('locales/en.yml')).toContain('# keep')
    expect(project.message('app.added', 'en')?.value).toBe('New')
    await write(project, [
      { type: 'delete', key: 'app' },
    ])
    expect(files.get('locales/en.yml')).toBe('# top\nlist: plain\n')
  })

  // Each file: `a` with a comment, `b` without one. The edit sets `a`, adds `c` and deletes `b`.
  it.each([
    ['json', '{\n  // c1\n  "a": "A", // c2\n  /* c3 */\n  "b": "B"\n}\n', '{\n  // c1\n  "a": "A2", // c2\n  /* c3 */\n  "c": "C"\n}\n'],
    ['jsonc', '{\n\t// c1\n\t"a": "A", // c2\n\t"b": "B",\n}\n', '{\n\t// c1\n\t"a": "A2", // c2\n\t"c": "C",\n}\n'],
    ['json5', '{\n  // c1\n  a: \'A\', // c2\n  /* c3 */\n  b: \'B\',\n}\n', '{\n  // c1\n  a: \'A2\', // c2\n  /* c3 */\n  c: \'C\',\n}\n'],
    ['yml', '# c1\na: A # c2\n# c3\nb: B\n', '# c1\na: A2 # c2\n# c3\nc: C\n'],
    ['po', '# c1\nmsgid ""\nmsgstr ""\n\n# c2\nmsgid "a"\nmsgstr "A"\n\nmsgid "b"\nmsgstr "B"\n', '# c1\nmsgid ""\nmsgstr ""\n\n# c2\nmsgid "a"\nmsgstr "A2"\n\nmsgid "c"\nmsgstr "C"\n'],
    ['properties', '# c1\na = A\n! c2\nb = B\n', '# c1\na = A2\n! c2\nc = C\n'],
    ['ftl', '### c1\n\n# c2\na = A\nb = B\n', '### c1\n\n# c2\na = A2\nc = C\n'],
    ['ini', '; c1\na = A ; c2\n# c3\nb = B\n', '; c1\na = A2 ; c2\n# c3\nc = C\n'],
    ['php', '<?php\n// c1\nreturn [\n    \'a\' => \'A\', # c2\n    /* c3 */\n    \'b\' => \'B\',\n];\n', '<?php\n// c1\nreturn [\n    \'a\' => \'A2\', # c2\n    /* c3 */\n    \'c\' => \'C\',\n];\n'],
    ['ts', '// c1\nexport default {\n  a: \'A\', // c2\n  /* c3 */\n  b: \'B\',\n} as const\n', '// c1\nexport default {\n  a: \'A2\', // c2\n  /* c3 */\n  c: \'C\',\n} as const\n'],
    ['resx', '<root>\n  <!-- c1 -->\n  <data name="a"><value>A</value><comment>c2</comment></data>\n  <data name="b"><value>B</value></data>\n</root>\n', '<root>\n  <!-- c1 -->\n  <data name="a"><value>A2</value><comment>c2</comment></data>\n  <data name="c" xml:space="preserve">\n    <value>C</value>\n  </data>\n</root>\n'],
  ])('%s keeps comments when it sets, adds and deletes keys', async (extension, before, after) => {
    const path = `locales/en.${extension}`
    const { project, files } = await createTestProject({ [path]: before }, {
      resources: [
        { pattern: `locales/{locale}.${extension}` },
      ],
    })
    const plan = await write(project, [
      {
        type: 'set',
        key: 'a',
        locale: 'en',
        value: 'A2',
      },
      {
        type: 'set',
        key: 'c',
        locale: 'en',
        value: 'C',
      },
      { type: 'delete', key: 'b' },
    ])
    expect(plan.warnings).toEqual([])
    expect(files.get(path)).toBe(after)
    expect(project.message('c', 'en')?.value).toBe('C')
  })

  it('follows the nesting style of the target file', async () => {
    const { project, files } = await createTestProject({
      'flat/en.json': json({ 'a.b': 'x' }),
    }, {
      resources: [
        { pattern: 'flat/{locale}.json' },
      ],
    })
    await write(project, [
      {
        type: 'set',
        key: 'a.c',
        locale: 'en',
        value: 'y',
      },
    ])
    expect(JSON.parse(files.get('flat/en.json')!)).toEqual({ 'a.b': 'x', 'a.c': 'y' })
  })

  it('creates a resource for a new locale next to the source one', async () => {
    const { project, files } = await createTestProject({
      'locales/en.json': json({ a: 'A' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    const plan = await write(project, [
      {
        type: 'set',
        key: 'a',
        locale: 'de',
        value: 'Ä',
      },
    ])
    expect(plan.changes[0]).toMatchObject({ type: 'create', path: 'locales/de.json' })
    expect(JSON.parse(files.get('locales/de.json')!)).toEqual({ a: 'Ä' })
    expect(project.locales).toEqual(['en', 'de'])
  })

  it('does not invent a file for a new locale that no pattern would read', async () => {
    const { project } = await createTestProject({
      'src/strings.json': json({ a: 'A' }),
    }, {
      resources: [
        { pattern: 'src/strings.json', locale: 'en' },
      ],
    })
    expect(() => project.plan([
      {
        type: 'set',
        key: 'a',
        locale: 'de',
        value: 'Ä',
      },
    ])).toThrow(expect.objectContaining({ code: 'X18N4005' }))
  })

  it('places new keys by longest prefix, asks only on a tie', async () => {
    const { project } = await createTestProject({
      'locales/en/a.json': json({
        pages: { home: 'H' },
      }),
      'locales/en/b.json': json({
        nav: { x: 'X' },
      }),
    }, {
      resources: [
        { pattern: 'locales/{locale}/*.json' },
      ],
    })
    const byPrefix = project.plan([
      {
        type: 'set',
        key: 'nav.y',
        locale: 'en',
        value: 'Y',
      },
    ])
    expect(byPrefix.decisions).toEqual([])
    expect(byPrefix.changes.map(c => c.path)).toEqual(['locales/en/b.json'])
    const tie = project.plan([
      {
        type: 'set',
        key: 'other',
        locale: 'en',
        value: 'O',
      },
    ])
    expect(tie.changes.map(c => c.path)).toEqual(['locales/en/a.json'])
  })

  it('keepFilled adds empty values to the other locales', async () => {
    const { project, files } = await createTestProject({
      'locales/en.json': json({ a: 'A' }),
      'locales/de.json': json({ a: 'Ä' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      write: { keepFilled: true },
    })
    await write(project, [
      {
        type: 'set',
        key: 'b',
        locale: 'en',
        value: 'B',
      },
    ])
    expect(JSON.parse(files.get('locales/de.json')!)).toEqual({ a: 'Ä', b: '' })
  })

  it('refuses stale plans and read-only resources', async () => {
    const { project, files } = await createTestProject({
      'locales/en.json': json({ a: 'A' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    const plan = project.plan([
      {
        type: 'set',
        key: 'a',
        locale: 'en',
        value: 'B',
      },
    ])
    files.set('locales/en.json', json({ a: 'changed' }))
    await expect(project.apply(plan)).rejects.toMatchObject({ code: 'X18N4004' })
    const readonly = await createTestProject({
      'locales/en.json': json({ a: 'A' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json', execute: true },
      ],
    })
    expect(() => readonly.project.plan([
      {
        type: 'set',
        key: 'a',
        locale: 'en',
        value: 'B',
      },
    ])).toThrow(expect.objectContaining({ code: 'X18N4001' }))
  })

  it('sort and format re-write resources', async () => {
    const { project, files } = await createTestProject({ 'locales/en.json': '{"b":"B","a":{"d":"D","c":"C"}}' }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      write: { sort: 'binary', indent: 2 },
    })
    await write(project, [
      { type: 'format' },
    ])
    expect(files.get('locales/en.json')).toBe('{\n  "a": {\n    "c": "C",\n    "d": "D"\n  },\n  "b": "B"\n}\n')
  })
})

describe('rename', () => {
  const vueFiles = {
    'package.json': json({
      dependencies: { 'vue-i18n': '*' },
    }),
    'src/locales/en.json': json({
      home: { title: 'Home', sub: 'Sub' },
      pages: {
        a: { title: 'A' },
        b: 'B',
      },
    }),
    'src/locales/de.json': json({
      home: { title: 'Start' },
      pages: {
        a: { title: 'Ä' },
      },
    }),
    'src/App.vue': '<template>\n  <h1>{{ $t(\'home.title\') }}</h1>\n  <p>{{ $t(`pages.${id}.title`) }}</p>\n  <p>{{ t(\'pages.b\') }}</p>\n</template>\n', // eslint-disable-line no-template-curly-in-string
  }

  it('renames a key in every locale and in code, in place', async () => {
    const { project, files } = await createTestProject(vueFiles, {
      presets: [
        vueI18n(),
      ],
    })
    const before = files.get('src/locales/en.json')!
    const plan = await write(project, [
      { type: 'rename', from: 'home.title', to: 'home.heading' },
    ])
    expect(files.get('src/locales/en.json')).toBe(before.replace('"title": "Home"', '"heading": "Home"'))
    expect(files.get('src/locales/de.json')).toContain('"heading": "Start"')
    expect(files.get('src/App.vue')).toContain('$t(\'home.heading\')')
    expect(plan.warnings).toEqual([])
    expect(project.usages({ key: 'home.heading' })).toHaveLength(1)
  })

  it('re-nests and removes parents left empty', async () => {
    const { project, files } = await createTestProject(vueFiles, {
      presets: [
        vueI18n(),
      ],
    })
    await write(project, [
      { type: 'rename', from: 'home.title', to: 'start.page.title' },
    ])
    const de = JSON.parse(files.get('src/locales/de.json')!)
    expect(de.home).toBeUndefined()
    expect(de.start).toEqual({
      page: { title: 'Start' },
    })
    expect(files.get('src/App.vue')).toContain('$t(\'start.page.title\')')
  })

  it('renames a subtree and rewrites the static part of dynamic usages', async () => {
    const { project, files } = await createTestProject(vueFiles, {
      presets: [
        vueI18n(),
      ],
    })
    const before = files.get('src/locales/en.json')!
    const plan = await write(project, [
      { type: 'rename-prefix', from: 'pages', to: 'screens' },
    ])
    // The parent is renamed in place; the subtree keeps its position.
    expect(files.get('src/locales/en.json')).toBe(before.replace('"pages"', '"screens"'))
    const en = JSON.parse(files.get('src/locales/en.json')!)
    expect(en.screens).toEqual({
      a: { title: 'A' },
      b: 'B',
    })
    expect(en.pages).toBeUndefined()
    expect(files.get('src/App.vue')).toContain('$t(`screens.${id}.title`)') // eslint-disable-line no-template-curly-in-string
    expect(files.get('src/App.vue')).toContain('t(\'screens.b\')')
    expect(plan.warnings).toEqual([])
  })

  it('treats a rename of a parent key as a subtree rename', async () => {
    const { project, files } = await createTestProject(vueFiles, {
      presets: [
        vueI18n(),
      ],
    })
    await write(project, [
      { type: 'rename', from: 'home', to: 'start' },
    ])
    expect(Object.keys(JSON.parse(files.get('src/locales/en.json')!))).toContain('start')
  })

  it('refuses when the target exists, listing the files', async () => {
    const { project } = await createTestProject(vueFiles, {
      presets: [
        vueI18n(),
      ],
    })
    expect(() => project.plan([
      { type: 'rename', from: 'home.title', to: 'home.sub' },
    ])).toThrow(expect.objectContaining({
      code: 'X18N4002',
      message: expect.stringContaining('src/locales/en.json'),
    }))
  })

  it('warns about dynamic usages it cannot follow', async () => {
    const { project } = await createTestProject(vueFiles, {
      presets: [
        vueI18n(),
      ],
    })
    const plan = project.plan([
      { type: 'rename', from: 'pages.a.title', to: 'pages.a.heading' },
    ])
    expect(plan.warnings).toEqual([
      expect.stringContaining('dynamic usage "pages."'),
    ])
  })

  it('moves keys across namespaces, creating files, and rewrites scoped usages', async () => {
    const { project, files } = await createTestProject({
      'package.json': json({
        dependencies: { 'react-i18next': '*' },
      }),
      'locales/en/common.json': json({ save: 'Save', cancel: 'Cancel' }),
      'locales/de/common.json': json({ save: 'Speichern' }),
      'src/App.tsx': `const { t } = useTranslation('common')\nt('save')\nt('common:save')\n`,
    }, {
      presets: [
        reactI18next(),
      ],
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
    })
    await write(project, [
      { type: 'rename', from: 'common:save', to: 'actions:store' },
    ])
    expect(JSON.parse(files.get('locales/en/actions.json')!)).toEqual({ store: 'Save' })
    expect(JSON.parse(files.get('locales/de/actions.json')!)).toEqual({ store: 'Speichern' })
    expect(JSON.parse(files.get('locales/en/common.json')!)).toEqual({ cancel: 'Cancel' })
    expect(files.get('src/App.tsx')).toBe(`const { t } = useTranslation('common')\nt('actions:store')\nt('actions:store')\n`)
  })

  it('renames derived plural keys with their base', async () => {
    const { project, files } = await createTestProject({
      'package.json': json({
        dependencies: { i18next: '*' },
      }),
      'locales/en/translation.json': json({ item_one: '1', item_other: 'n', item_male_other: 'm' }),
      'src/a.ts': `i18next.t('item', { count })`,
    }, {
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
    })
    await write(project, [
      { type: 'rename', from: 'translation:item', to: 'translation:thing' },
    ])
    expect(JSON.parse(files.get('locales/en/translation.json')!)).toEqual({ thing_one: '1', thing_other: 'n', thing_male_other: 'm' })
    expect(files.get('src/a.ts')).toBe(`i18next.t('thing', { count })`)
  })
})

describe('prompts', () => {
  it('builds a translate prompt with context, examples and paging', async () => {
    const { project } = await createTestProject({
      'package.json': json({
        dependencies: { 'vue-i18n': '*' },
      }),
      'src/locales/en.json': json({ a: 'Open {name}', b: 'Save', c: 'Close' }),
      'src/locales/de.json': json({ c: 'Schließen' }),
      'src/App.vue': '<template>\n  <button>{{ $t(\'a\', { name }) }}</button>\n</template>\n',
    }, {
      glossary: [
        {
          term: 'Open',
          translations: { de: 'Öffnen' },
        },
      ],
    })
    const data = project.prompt('translate', 'de', { limit: 1 })
    expect(data).toMatchObject({
      total: 2,
      remaining: 1,
      nextCursor: '1',
      examples: [
        { key: 'c', target: 'Schließen' },
      ],
    })
    expect(data.items).toEqual([
      {
        key: 'a',
        source: 'Open {name}',
        placeholders: ['{name}'],
        existing: undefined,
        context: [
          { path: 'src/App.vue', line: 2, snippet: '<template>\n  <button>{{ $t(\'a\', { name }) }}</button>\n</template>' },
        ],
      },
    ])
    expect(data.glossary).toEqual([
      {
        term: 'Open',
        translation: 'Öffnen',
        note: undefined,
        doNotTranslate: false,
      },
    ])
    expect(project.prompt('translate', 'de', { cursor: '1' }).items.map(i => i.key)).toEqual(['b'])
    expect(project.prompt('review', 'de').items.map(i => i.key)).toEqual(['c'])
  })

  it('adds values that checks report with check, and leaves copies of the source out of the examples', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({
        greeting: 'Hello',
        farewell: 'Goodbye',
        ok: 'OK',
        save: 'Save',
      }),
      'locales/de.json': json({
        greeting: 'Hello',
        farewell: '',
        ok: 'OK',
        save: 'Speichern',
      }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    const plain = project.prompt('translate', 'de', { context: false })
    expect(plain.items.map(i => i.key)).toEqual(['farewell'])
    expect(plain.examples.map(e => e.key)).toEqual(['save'])
    const checked = project.prompt('translate', 'de', { check: true, context: false })
    expect(checked.items.map(i => [i.key, i.existing, i.issues])).toEqual([
      ['farewell', undefined, undefined],
      [
        'greeting',
        'Hello',
        [
          { code: 'identical-to-source', message: '"greeting" in de is the same as in en.' },
        ],
      ],
    ])
    expect(checked.rules.at(-1)).toMatch(/^A message with a reported problem/)
    expect(renderPrompt(checked)).toContain('- Reported: "greeting" in de is the same as in en. (`identical-to-source`)')
    expect(project.prompt('translate', 'de', {
      check: ['glossary'],
    }).items.map(i => i.key)).toEqual(['farewell'])
    expect(project.prompt('review', 'de', { check: true }).items.map(i => i.key)).toEqual(['greeting', 'ok', 'save'])
  })
})
