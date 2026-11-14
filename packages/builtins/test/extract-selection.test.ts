import type { UserConfig } from '@x18n/core'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import { extractItems, findCandidates, findSelections, renderSelections } from '../src/extractors'
import { createTestProject, json } from './_utils'

function vue(text: string, extract: UserConfig['extract'] = {}) {
  return createTestProject({
    'locales/en.json': json({}),
    'src/App.vue': `<template><h1>${text}</h1></template>`,
  }, {
    presets: ['vue-i18n'],
    resources: [
      { pattern: 'locales/{locale}.json' },
    ],
    extract,
  })
}

describe('generated extraction selections', () => {
  it.each([
    ['Welcome aboard', 'page.welcome'],
    ['Don\'t stop now', 'page.stop'],
    ['Welcome aboard', 'page.user\'sWelcome'],
    ['t', 'page.label'],
    ['Welcome aboard', 'page.$&'],
    ['Welcome aboard', 'A &amp; B'],
    ['Welcome aboard', 'page.}}'],
    ['Pay $& now', 'Pay $& now'],
  ])('renders %s as the selected key %s', async (text, key) => {
    const { project, files } = await vue(text, { keygen: 'source' })
    const candidate = findSelections(project)[0]!
    const items = renderSelections(project, [
      { ...candidate, key },
    ])
    await project.apply(project.plan([
      { type: 'extract', items },
    ]))
    const content = files.get('src/App.vue')!
    const compiled = compileTemplate({ source: parse(content).descriptor.template!.content, filename: 'App.vue', id: 'test' })
    expect(compiled.errors).toEqual([])
    expect([
      ...project.usages(),
    ].map(({ usage }) => usage.key)).toContain(project.parseKey(key))
    expect(project.message(project.parseKey(key), project.sourceLocale)?.value).toBe(text)
  })

  it('keeps the default text inside a custom Vue interpolation', async () => {
    const { project, files } = await vue('Hello }} friend', {
      templates: [
        {
          template: '{{ $t(\'{key}\', \'Default: {text}\') }}',
          kinds: ['vue-template-text'],
        },
      ],
    })
    const [selection] = findSelections(project)
    const items = renderSelections(project, [
      { ...selection!, key: 'welcome' },
    ])
    await project.apply(project.plan([
      { type: 'extract', items },
    ]))
    const source = parse(files.get('src/App.vue')!).descriptor.template!.content
    const compiled = compileTemplate({ source, filename: 'App.vue', id: 'test' })
    expect(compiled.errors).toEqual([])
    expect(compiled.code).toContain('Default: Hello }} friend')
  })

  it('updates every key token, but not matching default text', async () => {
    const { project } = await vue('Welcome aboard', {
      keygen: 'source',
      templates: [
        {
          template: '{{ $t(\'{key}\', \'{text}\') + $t(\'{key}\') }}',
          kinds: ['vue-template-text'],
        },
      ],
    })
    const candidate = findSelections(project)[0]!
    const [item] = renderSelections(project, [
      { ...candidate, key: 'page.welcome' },
    ])
    expect(item!.replacement).toBe('{{ $t(\'page.welcome\', \'Welcome aboard\') + $t(\'page.welcome\') }}')
  })

  it.each([
    { separator: ':', key: 'translation:page.welcome', expected: 'page.welcome' },
    { separator: ':', key: 'other:page.welcome', expected: 'other:page.welcome' },
    { separator: '~', key: 'translation~page.welcome', expected: 'page.welcome' },
    { separator: '~', key: 'other~page.welcome', expected: 'other~page.welcome' },
    {
      separator: '~',
      fileNamespace: 'other',
      key: 'translation~page.welcome',
      expected: 'translation~page.welcome',
    },
    { separator: '~', key: 'translation:page~welcome', expected: 'translation~page~welcome' },
    {
      separator: false,
      fileNamespace: 'other',
      key: 'other:page.welcome',
      expected: 'page.welcome',
    },
    { separator: false, key: 'other:page.welcome', expected: undefined },
    {
      separator: false,
      scope: 'withTranslation(\'other\')',
      key: 'other:page.welcome',
      expected: 'page.welcome',
    },
    {
      separator: ':',
      scope: 'withTranslation(\'translation\', { keyPrefix: \'account\' })',
      key: 'translation:page.welcome',
      expected: 'translation:page.welcome',
    },
    {
      separator: false,
      scope: 'withTranslation(\'translation\', { keyPrefix: \'account\' })',
      key: 'translation:account.save',
      expected: 'save',
    },
    {
      separator: false,
      scope: 'withTranslation(\'translation\', { keyPrefix: \'account\' })',
      key: 'translation:save',
      expected: undefined,
    },
  ] as const)('renders $key with separator $separator as $expected', async (scenario) => {
    const { separator, key, expected } = scenario
    const app = 'export const App = () => <h1>Welcome aboard</h1>'
    const { project } = await createTestProject({
      'locales/en/translation.json': json({}),
      'locales/en/other.json': json({}),
      'src/App.tsx': 'scope' in scenario
        ? `${app}\nexport default ${scenario.scope}(App)`
        : app,
    }, {
      presets: ['react-i18next'],
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
      namespace: {
        default: 'translation',
        separator,
        byFile: 'fileNamespace' in scenario
          ? { 'src/**': scenario.fileNamespace }
          : {},
      },
    })
    const candidate = findSelections(project)[0]!
    expect(candidate.key).toBe('translation:welcomeAboard')
    const render = () => renderSelections(project, [
      { ...candidate, key },
    ])
    if (expected === undefined) {
      expect(render).toThrow(expect.objectContaining({ code: 'X18N4008' }))
      expect(project.keys()).toEqual([])
      return
    }
    const [item] = render()
    expect(item!.replacement).toBe(`<Trans i18nKey="${expected}" />`)
    expect(item!.imports).toEqual(candidate.imports)
    await project.apply(project.plan([
      {
        type: 'extract',
        items: [item!],
      },
    ]))
    const canonical = project.parseKey(key)
    expect([
      ...project.usages(),
    ].map(({ usage }) => usage.key)).toContain(canonical)
    expect(project.message(canonical, project.sourceLocale)?.value).toBe('Welcome aboard')
  })

  it('uses a lexical prefix in a flat resource project', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({}),
      'src/App.tsx': 'const App = () => <h1>Welcome aboard</h1>; export default withTranslation(\'translation\', {keyPrefix: \'account\'})(App)',
    }, {
      presets: ['react-i18next'],
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    const [candidate] = findSelections(project)
    const render = (key: string) => renderSelections(project, [
      { ...candidate!, key },
    ])
    expect(() => render('save')).toThrow(expect.objectContaining({ code: 'X18N4008' }))
    await project.apply(project.plan([
      {
        type: 'extract',
        items: render('account.save'),
      },
    ]))
    expect(project.usages().map(match => match.usage.key)).toContain('account.save')
    expect(project.message('account.save', 'en')?.value).toBe('Welcome aboard')
  })

  it('rejects a flat resource key from a namespaced file', async () => {
    const { project } = await createTestProject({
      'flat/en.json': json({}),
      'ns/en/other.json': json({}),
      'src/App.tsx': 'export const App = () => <h1>Welcome aboard</h1>',
    }, {
      presets: ['react-i18next'],
      resources: [
        { pattern: 'flat/{locale}.json' },
        { pattern: 'ns/{locale}/{namespace}.json' },
      ],
      namespace: {
        separator: false,
        default: '',
        byFile: { 'src/**': 'other' },
      },
    })
    const [selection] = findSelections(project)
    expect(project.parseKey('plain')).toBe('plain')
    expect(() => renderSelections(project, [
      { ...selection!, key: 'plain' },
    ])).toThrow(expect.objectContaining({ code: 'X18N4008' }))
  })

  it('preserves attributes, arguments, imports and unchanged replacements', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({}),
      // eslint-disable-next-line no-template-curly-in-string
      'src/App.vue': '<template>\n<h1 title="Hello there">Welcome aboard</h1>\n</template>\n<script setup>\nconst label = `Hello there ${user.name}`\n</script>',
    }, {
      presets: ['vue-i18n'],
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    const candidates = findCandidates(project)
    const selected = findSelections(project)
    expect(selected.map(c => c.kind)).toEqual(['js-template', 'vue-attribute', 'vue-template-text'])
    expect(renderSelections(project, selected)).toEqual(extractItems(project, candidates))
    const changed = renderSelections(project, selected.map((item, i) => ({ ...item, key: `new.key${i}` })))
    expect(changed.find(item => item.replacement.includes('user.name'))?.replacement).toContain('{ name: user.name }')
    expect(changed.find(item => item.replacement.startsWith(':title'))).toBeDefined()
  })

  it('retains source and structured parts in custom templates', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({}),
      // eslint-disable-next-line no-template-curly-in-string
      'src/App.vue': '<template><h1>Welcome aboard</h1></template>\n<script setup>\nconst label = `Hello there ${user.name}`\n</script>',
    }, {
      presets: ['vue-i18n'],
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      extract: {
        templates: [
          {
            kinds: ['vue-template-text'],
            template: '<span data-key="{key}">{source}</span>',
          },
          {
            kinds: ['js-template'],
            template: 'message(\'{key}\', `{parts}`)',
            imports: ['import { message } from "messages"'],
          },
        ],
      },
    })
    const selections = findSelections(project)
    const items = renderSelections(project, selections.map(item => ({ ...item, key: 'new.key' })))
    expect(items.find(item => item.replacement.startsWith('<span'))?.replacement).toBe('<span data-key="new.key">Welcome aboard</span>')
    const script = items.find(item => item.replacement.startsWith('message'))!
    // eslint-disable-next-line no-template-curly-in-string
    expect(script.replacement).toBe('message(\'new.key\', `Hello there ${user.name}:name:`)')
    expect(script.imports).toEqual(['import { message } from "messages"'])
  })

  it('does not reroll the selected random key', async () => {
    const { project } = await vue('Welcome aboard', { keygen: 'random' })
    const selected = findSelections(project)
    expect(renderSelections(project, selected)[0]!.replacement).toBe(selected[0]!.replacement)
  })

  it('rejects changed source and duplicate selections before application', async () => {
    const { project, files } = await vue('Welcome aboard')
    const selected = findSelections(project)
    expect(() => renderSelections(project, [
      ...selected,
      ...selected,
    ])).toThrow(expect.objectContaining({ code: 'X18N4004' }))
    files.set('src/App.vue', '<template><h1>Different text</h1></template>')
    await project.update([
      { type: 'change', path: 'src/App.vue' },
    ])
    expect(() => renderSelections(project, selected)).toThrow(expect.objectContaining({ code: 'X18N4004' }))
    expect(files.get('locales/en.json')).toBe(json({}))
  })

  it('rejects changed templates even when the source and key are unchanged', async () => {
    const before = await vue('Welcome aboard')
    const selected = findSelections(before.project)
    const after = await vue('Welcome aboard', {
      templates: [
        {
          template: '{{ another(\'{key}\') }}',
          kinds: ['vue-template-text'],
        },
      ],
    })
    expect(() => renderSelections(after.project, selected)).toThrow(expect.objectContaining({ code: 'X18N4004' }))
  })

  it.each(['pages.cart.save', 'pages.cart.save.label'])('rejects a batch that shadows a global key with %s', async (local) => {
    const { project, files } = await createTestProject({
      'locales/en.json': json({}),
      'pages/cart.vue': '<template><p>Global save</p><p>Local label</p></template>',
    }, {
      presets: ['nuxt-i18n-micro'],
    })
    const [first, second] = findSelections(project)
    const global = { ...first!, key: 'save' }
    const scoped = { ...second!, key: local }
    expect(() => renderSelections(project, [global, scoped])).toThrow(expect.objectContaining({ code: 'X18N4008' }))
    expect(() => renderSelections(project, [scoped, global])).toThrow(expect.objectContaining({ code: 'X18N4008' }))
    expect(files.get('locales/en.json')).toBe(json({}))
    const items = renderSelections(project, [
      { ...global, key: 'checkout' },
      scoped,
    ])
    await project.apply(project.plan([
      { type: 'extract', items },
    ]))
    expect(project.usages().map(match => match.usage.key)).toEqual(['checkout', local])
  })

  it('checks flat resource keys against the preset normalizer', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({}),
      'src/cart.js': 'const label = "Cart title"',
    }, {
      presets: ['globalize'],
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    const [row] = findSelections(project)
    expect(() => renderSelections(project, [
      { ...row!, key: 'cart/title' },
    ])).toThrow(expect.objectContaining({ code: 'X18N4008' }))
    expect(project.keys()).toEqual([])
    const items = renderSelections(project, [
      { ...row!, key: 'cart.title' },
    ])
    await project.apply(project.plan([
      { type: 'extract', items },
    ]))
    expect(project.usages().map(match => match.usage.key)).toEqual(['cart.title'])
    expect(project.message('cart.title', 'en')?.value).toBe('Cart title')
  })

  it.each(['account-save', 'account\'s label', 'hi<!--tag-->world'])('calls the selected Paraglide message %s', async (key) => {
    const { project } = await createTestProject({
      'messages/en.json': json({}),
      'src/cart.js': 'const label = "Cart title"',
    }, {
      presets: ['paraglide'],
    })
    const [row] = findSelections(project)
    const items = renderSelections(project, [
      { ...row!, key },
    ])
    const { parseSync } = await import('oxc-parser')
    const parsed = parseSync('call.js', items[0]!.replacement)
    expect(parsed.errors).toEqual([])
    expect(parsed.program.body[0]).toMatchObject({
      expression: {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          computed: true,
          object: { name: 'm' },
          property: { value: key },
        },
      },
    })
    await project.apply(project.plan([
      { type: 'extract', items },
    ]))
    expect(project.usages().map(match => match.usage.key)).toEqual([key])
    expect(project.message(key, 'en')?.value).toBe('Cart title')
  })

  it('keeps explicit saved replacements verbatim', async () => {
    const { project } = await vue('Welcome aboard')
    const candidate = findCandidates(project)[0]!
    expect(candidate).not.toHaveProperty('context')
    expect(extractItems(project, [
      { ...candidate, key: 'manual', replacement: '{{ custom() }}' },
    ])[0]!.replacement).toBe('{{ custom() }}')
  })
})
