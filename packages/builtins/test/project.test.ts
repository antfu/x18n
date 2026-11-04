import { describe, expect, it } from 'vitest'
import { createTestProject, json } from './_utils'

describe('project read path', () => {
  it('reads nested JSON per locale and reports coverage', async () => {
    const { project } = await createTestProject({
      'src/locales/en.json': json({
        home: { title: 'Home', subtitle: 'Welcome {name}' },
        empty: 'x',
      }),
      'src/locales/de.json': json({
        home: { title: 'Startseite', subtitle: 'Willkommen' },
        empty: '',
      }),
      'src/locales/fr.json': json({
        home: { title: 'Accueil' },
      }),
    }, {
      resources: [
        { pattern: 'src/locales/{locale}.json' },
      ],
    })

    expect(project.locales).toEqual(['en', 'de', 'fr'])
    expect(project.keys()).toEqual(['empty', 'home.subtitle', 'home.title'])
    expect(project.message('home.title', 'de')?.value).toBe('Startseite')
    const analysis = project.analyze()
    expect(analysis.coverage.map(c => [
      c.locale,
      c.translated,
      c.missing,
      c.empty,
    ])).toEqual([
      ['en', 3, [], []],
      [
        'de',
        2,
        [],
        ['empty'],
      ],
      [
        'fr',
        1,
        ['empty', 'home.subtitle'],
        [],
      ],
    ])
    expect(analysis.diagnostics.map(d => `${d.code}:${d.key}:${d.location?.path}`)).toEqual([
      'empty-translation:empty:src/locales/de.json',
      'missing-translation:home.subtitle:src/locales/en.json',
      'missing-translation:empty:src/locales/en.json',
    ])
    const missing = analysis.diagnostics.find(d => d.key === 'home.subtitle')!
    expect(missing.message).toBe('"home.subtitle" is missing in fr.')
    const text = project.text('src/locales/en.json')!
    expect(text.slice(missing.location!.range.start, missing.location!.range.end)).toBe('subtitle')
  })

  it('searches keys by value in any locale, fuzzy unless exact', async () => {
    const { project } = await createTestProject({
      'src/locales/en.json': json({
        title: 'Home',
        greeting: 'Welcome home',
        count: 3,
        save: 'Save changes',
      }),
      'src/locales/zh.json': json({ title: '主页', greeting: '你好' }),
    }, {
      resources: [
        { pattern: 'src/locales/{locale}.json' },
      ],
    })
    const found = (query: string, exact?: boolean): string[] => project.search(query, { exact }).map(m => `${m.key}:${m.locale}:${m.value}`)
    expect(found('HOME', true)).toEqual(['title:en:Home', 'greeting:en:Welcome home'])
    expect(found('你好')).toEqual(['greeting:zh:你好'])
    expect(found('3')).toEqual(['count:en:3'])
    expect(found('svchg')).toEqual(['save:en:Save changes'])
    expect(found('svchg', true)).toEqual([])
    expect(found('')).toEqual([])
  })

  it('treats locales with a fallback as overrides', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({ color: 'Color', save: 'Save' }),
      'locales/en-US.json': json({}),
      'locales/en-GB.json': json({ color: 'Colour', save: '' }),
      'locales/de.json': json({ color: 'Farbe' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      localeFallbacks: { 'en-US': 'en', 'en-GB': 'en-US' },
    })
    const analysis = project.analyze()
    expect(analysis.coverage.map(c => [
      c.locale,
      c.translated,
      c.missing,
      c.empty,
    ])).toEqual([
      ['en', 2, [], []],
      [
        'de',
        1,
        ['save'],
        [],
      ],
      ['en-GB', 2, [], []],
      ['en-US', 2, [], []],
    ])
    expect(analysis.diagnostics.map(d => `${d.code}:${d.key}`)).toEqual(['missing-translation:save'])
  })

  it('derives fallbacks from parent languages with "auto"', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({ color: 'Color', save: 'Save', cancel: 'Cancel' }),
      'locales/en-US.json': json({ save: 'Save' }),
      'locales/en-GB.json': json({ color: 'Colour', cancel: 'Cancel' }),
      'locales/zh-Hant-TW.json': json({ color: '顏色' }),
      'locales/pt-BR.json': json({ color: 'Cor' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      localeFallbacks: 'auto',
    })
    const analysis = project.analyze()
    expect(analysis.coverage.map(c => [c.locale, c.missing])).toEqual([
      ['en', []],
      ['en-GB', []],
      ['en-US', []],
      [
        'pt-BR',
        ['cancel', 'save'],
      ],
      [
        'zh-Hant-TW',
        ['cancel', 'save'],
      ],
    ])
    const redundant = analysis.diagnostics.filter(d => d.code === 'redundant-translation')
    expect(redundant.map(d => `${d.locale}:${d.key}`)).toEqual(['en-GB:cancel', 'en-US:save'])
    expect(redundant[1]!.message).toBe('"save" in en-US is the same as in en, which it falls back to.')
    expect(redundant[1]!.fixes[0]!.ops).toEqual([
      {
        type: 'delete',
        key: 'save',
        locales: ['en-US'],
      },
    ])
  })

  it('reads namespaces from paths', async () => {
    const { project } = await createTestProject({
      'locales/en/common.json': json({ save: 'Save' }),
      'locales/en/auth.json': json({
        login: { title: 'Log in' },
      }),
      'locales/de/common.json': json({ save: 'Speichern' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
      namespace: { separator: ':' },
    })
    expect(project.namespaced).toBe(true)
    expect(project.keys()).toEqual(['auth:login.title', 'common:save'])
    expect(project.get('auth:login.title')?.missing).toEqual(['de'])
    expect(project.parseKey('common:save')).toBe('common:save')
  })

  it('merges path namespaces into keys with the default separator', async () => {
    const { project } = await createTestProject({
      'locales/en/pages/home.yml': 'title: Home # comment\nnested:\n  deep: "Deep"\n',
    }, {
      resources: [
        { pattern: 'locales/{locale}/{namespaces}.{ext}' },
      ],
    })
    expect(project.keys()).toEqual(['pages.home.nested.deep', 'pages.home.title'])
    const message = project.message('pages.home.nested.deep', 'en')!
    const text = project.text('locales/en/pages/home.yml')!
    expect(text.slice(message.range!.key.start, message.range!.key.end)).toBe('deep')
  })

  it('guesses resources without config and keeps locale codes as found', async () => {
    const { project } = await createTestProject({
      'i18n/en.json': json({ a: 'A' }),
      'i18n/zh_CN.json': json({ a: 'A' }),
      'i18n/zh-CN.json': json({ a: 'A' }),
      'other/readme.json': json({ a: 'A' }),
    })
    expect(project.locales).toEqual(['en', 'zh-CN', 'zh_CN'])
    expect(project.analyze().diagnostics.map(d => d.code)).toContain('locale-code-conflict')
    expect(project.localeInfo('zh_CN')).toMatchObject({
      language: 'zh',
      region: 'CN',
      displayName: 'Chinese (China)',
      flag: '🇨🇳',
    })
  })

  it('reports leaf and parent conflicts and parse errors', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({ 'a': 'x', 'a.b': 'y' }),
      'locales/de.json': '{ "a": ',
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    const codes = project.analyze().diagnostics.map(d => d.code)
    expect(codes).toContain('key-conflict')
    expect(codes).toContain('invalid-resource')
  })

  it('honours check overrides, strict mode and ignoreKeys', async () => {
    const files = {
      'locales/en.json': json({
        a: 'A',
        b: 'B',
        skip: { me: 'x' },
        step: { s01: 'One', s02: 'Two' },
      }),
      'locales/de.json': json({}),
    }
    const { project } = await createTestProject(files, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      strict: true,
      ignoreKeys: ['skip.**', /^step\.s\d{2}$/],
      checks: { 'empty-translation': 'off' },
    })
    expect(project.analyze().diagnostics.map(d => `${d.severity}:${d.key}`)).toEqual(['error:a', 'error:b'])
  })

  it('explains how the project was understood', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({ a: 'A' }),
    })
    const explanation = project.explain()
    expect(explanation.finders).toEqual([
      {
        id: 'pattern',
        resources: ['locales/en.json'],
      },
    ])
    expect(explanation.formats.find(f => f.id === 'json')?.resources).toBe(1)
  })
})
