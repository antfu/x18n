import { describe, expect, it } from 'vitest'
import { createTestProject, json } from './_utils'

const pkg = json({
  dependencies: { 'i18next': '*', 'react-i18next': '*' },
})

describe('planFixes', () => {
  it('applies safe fixes, and unsafe ones only when asked', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg,
      'locales/en/translation.json': json({ old: 'Old' }),
      'locales/de/translation.json': json({ old: 'Alt' }),
      'src/App.tsx': 'function App() { const { t } = useTranslation(); return t(\'home.title\', \'Home\') + t(\'home.title\') }\n',
    })
    const diagnostics = project.analyze().diagnostics

    const safe = project.planFixes(diagnostics)
    expect(safe.fixed.map(d => d.code)).toEqual(['missing-key', 'missing-key'])
    expect(safe.skipped.map(d => [d.code, d.key])).toEqual([
      ['unused-key', 'translation:old'],
    ])
    expect(safe.plan.keys).toEqual(['translation:home.title'])

    const all = project.planFixes(diagnostics, { unsafe: true })
    expect(all.skipped).toEqual([])
    await project.apply(all.plan)
    // The first usage's default value wins, in the source locale only.
    expect(JSON.parse(files.get('locales/en/translation.json')!)).toEqual({
      home: { title: 'Home' },
    })
    expect(JSON.parse(files.get('locales/de/translation.json')!)).toEqual({})
    expect(project.analyze().diagnostics.filter(d => d.code === 'missing-key' || d.code === 'unused-key')).toEqual([])
  })

  it('deletes first, so a deleted message makes room for a used key under it in one plan', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg,
      'locales/en/translation.json': json({ home: 'Home' }),
      'src/App.tsx': 'function App() { const { t } = useTranslation(); return t(\'home.title\') }\n',
    })
    const safe = project.planFixes(project.analyze().diagnostics)
    expect(safe.plan.warnings).toEqual(['"translation:home.title" is not added: "home" is a message in locales/en/translation.json, and adding "translation:home.title" would replace it.'])
    expect(safe.plan.changes).toEqual([])

    const all = project.planFixes(project.analyze().diagnostics, { unsafe: true })
    expect(all.plan.warnings).toEqual([])
    await project.apply(all.plan)
    expect(JSON.parse(files.get('locales/en/translation.json')!)).toEqual({
      home: { title: '' },
    })
  })

  it('leaves out keys a scoped dynamic usage may reach, and warns about unscoped ones, as planUnused does', async () => {
    const { project } = await createTestProject({
      'package.json': pkg,
      'locales/en/translation.json': json({
        menu: { open: 'Open' },
        old: 'Old',
      }),
      'src/Menu.tsx': 'function Menu({ action }) { const { t } = useTranslation(undefined, { keyPrefix: \'menu\' }); return t(action) }\n',
      'src/Any.tsx': 'function Any({ key }) { const { t } = useTranslation(); return t(key) }\n',
    })
    const diagnostics = project.analyze().diagnostics
    const unused = diagnostics.filter(d => d.code === 'unused-key')
    expect(unused.map(d => [d.key, d.fixes[0]?.level])).toEqual([
      ['translation:menu.open', undefined],
      ['translation:old', 'unsafe'],
    ])
    const fixes = project.planFixes(diagnostics, { unsafe: true })
    expect(fixes.fixed.map(d => d.key)).toEqual(['translation:old'])
    expect(fixes.plan.warnings).toEqual(['1 usage has a fully dynamic key (in src/Any.tsx) that may reach any key; list the keys they use in `usage.keysInUse` to keep them.'])
    expect(project.planUnused().plan.warnings).toEqual(fixes.plan.warnings)
  })
})
