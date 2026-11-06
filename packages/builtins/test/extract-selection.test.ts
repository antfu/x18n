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
    [':', 'translation'],
    [':', 'other'],
    ['~', 'translation'],
    ['~', 'other'],
  ])('renders namespace separator %s in %s', async (separator, namespace) => {
    const key = `${namespace}${separator}page.welcome`
    const { project } = await createTestProject({
      'locales/en/translation.json': json({}),
      'locales/en/other.json': json({}),
      'src/App.tsx': 'export const App = () => <h1>Welcome aboard</h1>',
    }, {
      presets: ['react-i18next'],
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
      namespace: { default: 'translation', separator },
    })
    const candidate = findSelections(project)[0]!
    expect(candidate.key).toBe('translation:welcomeAboard')
    const [item] = renderSelections(project, [
      { ...candidate, key },
    ])
    expect(item!.replacement).toBe(namespace === 'translation'
      ? '<Trans i18nKey="page.welcome" />'
      : `<Trans i18nKey="other${separator}page.welcome" />`)
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

  it('keeps explicit saved replacements verbatim', async () => {
    const { project } = await vue('Welcome aboard')
    const candidate = findCandidates(project)[0]!
    expect(candidate).not.toHaveProperty('context')
    expect(extractItems(project, [
      { ...candidate, key: 'manual', replacement: '{{ custom() }}' },
    ])[0]!.replacement).toBe('{{ custom() }}')
  })
})
