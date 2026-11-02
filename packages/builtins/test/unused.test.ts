import { describe, expect, it } from 'vitest'
import { createTestProject, json } from './_utils'

const pkg = json({
  dependencies: { 'i18next': '*', 'react-i18next': '*' },
})

describe('planUnused', () => {
  it('plans unused keys per locale and file, and deletes them in place', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg,
      'locales/en/translation.json': json({
        app: { title: 'App', gone: 'Gone' },
        items: { a: 'A', b: 'B' },
        old: 'Old',
        kept: 'Kept',
        legacy: { x: 'X' },
      }),
      'locales/de/translation.json': json({
        app: { title: 'App', gone: 'Weg' },
        old: 'Alt',
      }),
      'src/App.tsx': 'function App({ id }) { const { t } = useTranslation(); return t(\'app.title\') + t(`items.${id}`) }\n', // eslint-disable-line no-template-curly-in-string
    }, {
      usage: {
        keysInUse: ['translation:kept'],
      },
      ignoreKeys: ['translation:legacy.**'],
    })

    const deletion = project.planUnused()
    expect(deletion.keys).toEqual([
      {
        key: 'translation:app.gone',
        messages: [
          { locale: 'en', path: 'locales/en/translation.json' },
          { locale: 'de', path: 'locales/de/translation.json' },
        ],
      },
      {
        key: 'translation:old',
        messages: [
          { locale: 'en', path: 'locales/en/translation.json' },
          { locale: 'de', path: 'locales/de/translation.json' },
        ],
      },
    ])
    expect(deletion.kept).toEqual([])
    expect(deletion.plan.warnings).toEqual([])
    expect(deletion.plan.changes.map(c => c.path).sort()).toEqual(['locales/de/translation.json', 'locales/en/translation.json'])
    // A dry run writes nothing.
    expect(JSON.parse(files.get('locales/en/translation.json')!).old).toBe('Old')

    await project.apply(deletion.plan)
    expect(JSON.parse(files.get('locales/en/translation.json')!)).toEqual({
      app: { title: 'App' },
      items: { a: 'A', b: 'B' },
      kept: 'Kept',
      legacy: { x: 'X' },
    })
    expect(JSON.parse(files.get('locales/de/translation.json')!)).toEqual({
      app: { title: 'App' },
    })
    expect(project.planUnused().keys).toEqual([])
  })

  it('filters by glob and namespace', async () => {
    const { project } = await createTestProject({
      'package.json': pkg,
      'locales/en/translation.json': json({
        a: { x: 'X', y: 'Y' },
        b: 'B',
      }),
      'locales/en/errors.json': json({
        a: { z: 'Z' },
      }),
      'src/App.tsx': 'function App() { const { t } = useTranslation(); return t(\'b\') }\n',
    })
    expect(project.planUnused().keys.map(k => k.key)).toEqual(['errors:a.z', 'translation:a.x', 'translation:a.y'])
    expect(project.planUnused({ namespace: 'errors' }).keys.map(k => k.key)).toEqual(['errors:a.z'])
    expect(project.planUnused({ glob: 'translation:a.x' }).keys.map(k => k.key)).toEqual(['translation:a.x'])
  })

  it('keeps keys that a fully dynamic usage under a keyPrefix or namespace may reach', async () => {
    const { project } = await createTestProject({
      'package.json': pkg,
      'locales/en/translation.json': json({
        menu: { open: 'Open', close: 'Close' },
        other: 'Other',
        used: 'Used',
      }),
      'locales/en/errors.json': json({ notFound: 'Not found', denied: 'Denied' }),
      'src/Menu.tsx': 'function Menu({ action }) { const { t } = useTranslation(undefined, { keyPrefix: \'menu\' }); return t(action) }\n',
      'src/Errors.tsx': 'function Errors({ code }) { const { t } = useTranslation(\'errors\'); return t(code) }\n',
      'src/App.tsx': 'function App() { const { t } = useTranslation(); return t(\'used\') }\n',
    })
    const deletion = project.planUnused()
    expect(deletion.keys.map(k => k.key)).toEqual(['translation:other'])
    expect(deletion.kept.map(k => [
      k.key,
      k.usages.map(u => u.path),
    ])).toEqual([
      [
        'errors:denied',
        ['src/Errors.tsx'],
      ],
      [
        'errors:notFound',
        ['src/Errors.tsx'],
      ],
      [
        'translation:menu.close',
        ['src/Menu.tsx'],
      ],
      [
        'translation:menu.open',
        ['src/Menu.tsx'],
      ],
    ])
    expect(deletion.plan.warnings).toEqual([])
    // The check still reports them, as before: only the bulk delete is careful.
    expect(project.analyze().unused).toContain('translation:menu.open')
  })

  it('keeps keys under a dynamic prefix and warns about fully dynamic usages without a scope', async () => {
    const { project } = await createTestProject({
      'package.json': pkg,
      'locales/en/translation.json': json({
        pages: { home: 'Home', about: 'About' },
        page: 'Page',
        other: 'Other',
      }),
      'src/App.tsx': 'function App({ id, key }) { const { t } = useTranslation(); return t(`pages.${id}`) + t(key) }\n', // eslint-disable-line no-template-curly-in-string
    })
    const deletion = project.planUnused()
    expect(deletion.keys.map(k => k.key)).toEqual(['translation:other', 'translation:page'])
    expect(deletion.kept).toEqual([])
    expect(deletion.plan.warnings).toEqual([
      '1 usage has a fully dynamic key (in src/App.tsx) that may reach any key; list the keys they use in `usage.keysInUse` to keep them.',
    ])
  })

  it('keeps comments and formatting', async () => {
    const { project, files } = await createTestProject({
      'locales/en.yml': '# Messages\napp:\n  # The title\n  title: App\n  gone: Gone   # remove me\nfooter:   Footer\n',
      'src/App.vue': '<template>{{ $t(\'app.title\') }} {{ $t(\'footer\') }}</template>\n',
    }, {
      resources: [
        { pattern: 'locales/{locale}.yml' },
      ],
      usage: {
        regex: [
          {
            extensions: ['vue'],
            patterns: ['\\$t\\([\'"]({key})[\'"]'],
          },
        ],
      },
    })
    const deletion = project.planUnused()
    expect(deletion.keys.map(k => k.key)).toEqual(['app.gone'])
    await project.apply(deletion.plan)
    expect(files.get('locales/en.yml')).toBe('# Messages\napp:\n  # The title\n  title: App\nfooter:   Footer\n')
  })

  it('plans nothing without scanned source files', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({ a: 'A' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    const deletion = project.planUnused()
    expect(deletion.keys).toEqual([])
    expect(deletion.plan.changes).toEqual([])
  })
})
