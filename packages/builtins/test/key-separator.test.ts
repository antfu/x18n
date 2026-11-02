import type { Project } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { laravel } from '../src/presets/laravel'
import { pythonGettext } from '../src/presets/python-gettext'
import { reactI18next } from '../src/presets/react-i18next'
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

const sentences = {
  'Welcome back.': 'Welcome back.',
  'Note: read this': 'Note: read this',
  '欢迎回来。': '欢迎回来。',
  'a': 'A',
  'a.b': 'A B',
}

describe('keySeparator: false', () => {
  it('reads keys with ., : and CJK as one segment, with no parents', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json(sentences),
      'src/App.ts': `t('Welcome back.'); t('Note: read this'); t('欢迎回来。'); t('a.b'); t('Welcome back')`,
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      keySeparator: false,
      usage: {
        calls: [
          { callee: 't' },
        ],
      },
    })
    expect(project.keys()).toEqual([
      'Note: read this',
      'Welcome back.',
      'a',
      'a.b',
      '欢迎回来。',
    ])
    expect(project.get('Welcome back.')?.path).toEqual(['Welcome back.'])
    expect(project.get('a.b')?.path).toEqual(['a.b'])
    const analysis = project.analyze()
    // `Welcome back` is not the parent of `Welcome back.`, and `a` is not the parent of `a.b`.
    expect(analysis.undefinedUsages.map(u => u.key)).toEqual(['Welcome back'])
    expect(analysis.diagnostics.filter(d => d.code === 'key-conflict')).toEqual([])
    expect(project.keys({ glob: 'Welcome*' })).toEqual(['Welcome back.'])
  })

  it('with the default separator, a . splits the key', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({ 'a': 'A', 'a.b': 'A B' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    expect(project.get('a.b')?.path).toEqual(['a', 'b'])
    expect(project.analyze().diagnostics.filter(d => d.code === 'key-conflict').map(d => d.key)).toEqual(['a'])
  })

  it('writes a new key as one property, in place, in a nested file', async () => {
    const before = '{\n    "greeting": {\n        "hi": "Hi"\n    }\n}\n'
    const { project, files } = await createTestProject({ 'locales/en.json': before }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      keySeparator: false,
    })
    const plan = await write(project, [
      {
        type: 'set',
        key: 'Welcome back.',
        locale: 'en',
        value: 'Welcome back.',
      },
      {
        type: 'set',
        key: 'Note: x.y',
        locale: 'en',
        value: 'Note',
      },
      {
        type: 'set',
        key: '你好。世界',
        locale: 'en',
        value: '你好',
      },
    ])
    const after = files.get('locales/en.json')!
    expect(JSON.parse(after)).toEqual({
      'greeting': { hi: 'Hi' },
      'Welcome back.': 'Welcome back.',
      'Note: x.y': 'Note',
      '你好。世界': '你好',
    })
    for (const part of outsideEdits(before, plan, 'locales/en.json'))
      expect(after).toContain(part)
    expect(after.startsWith('{\n    "greeting": {\n        "hi": "Hi"\n    }')).toBe(true)
    expect(project.message('Welcome back.', 'en')?.storedPath).toEqual(['Welcome back.'])
  })

  it('renames and deletes a literal key without touching keys that start with it', async () => {
    const { project, files } = await createTestProject({
      'locales/en.json': json(sentences),
      'locales/de.json': json({ 'a': 'A', 'a.b': 'A B', 'Welcome back.': 'Willkommen zurück.' }),
      'src/App.ts': `t('Welcome back.')`,
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      keySeparator: false,
      usage: {
        calls: [
          { callee: 't' },
        ],
      },
    })
    await write(project, [
      { type: 'rename', from: 'Welcome back.', to: 'Welcome back, friend.' },
      { type: 'delete', key: 'a' },
    ])
    expect(JSON.parse(files.get('locales/de.json')!)).toEqual({ 'a.b': 'A B', 'Welcome back, friend.': 'Willkommen zurück.' })
    expect(JSON.parse(files.get('locales/en.json')!)).toMatchObject({ 'a.b': 'A B', 'Welcome back, friend.': 'Welcome back.' })
    expect(files.get('src/App.ts')).toBe(`t('Welcome back, friend.')`)
  })

  it('a custom separator splits keys and nests new ones', async () => {
    const { project, files } = await createTestProject({
      'locales/en.json': json({
        'home': { title: 'Home' },
        'about.us': 'About',
      }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      keySeparator: '_',
    })
    expect(project.keys()).toEqual(['about.us', 'home_title'])
    await write(project, [
      {
        type: 'set',
        key: 'home_sub.title',
        locale: 'en',
        value: 'Sub',
      },
    ])
    expect(JSON.parse(files.get('locales/en.json')!)).toEqual({
      'home': { 'title': 'Home', 'sub.title': 'Sub' },
      'about.us': 'About',
    })
  })
})

describe('presets with literal keys', () => {
  it('laravel: JSON sentence keys are literal, PHP keys keep their path', async () => {
    const { project, files } = await createTestProject({
      'composer.json': JSON.stringify({
        require: { 'laravel/framework': '^11.0' },
      }),
      'lang/en/messages.php': `<?php\n\nreturn [\n    'welcome' => 'Welcome',\n];\n`,
      'lang/en.json': json({ 'Welcome back.': 'Welcome back.', 'Hi': 'Hi' }),
      'lang/de.json': json({ Hi: 'Hallo' }),
      'resources/views/a.blade.php': `{{ __('Welcome back.') }} {{ __('messages.welcome') }} {{ __('Log in: now.') }}`,
    }, {
      presets: [
        laravel(),
      ],
    })
    expect(project.keys()).toEqual(['Hi', 'Welcome back.', 'messages.welcome'])
    expect(project.get('Welcome back.')?.path).toEqual(['Welcome back.'])
    expect(project.get('messages.welcome')?.path).toEqual(['messages', 'welcome'])
    expect(project.analyze().undefinedUsages.map(u => u.key)).toEqual(['Log in: now.'])
    await write(project, [
      {
        type: 'set',
        key: 'Log in: now.',
        locale: 'en',
        value: 'Log in: now.',
      },
      {
        type: 'set',
        key: 'Welcome back.',
        locale: 'de',
        value: 'Willkommen zurück.',
      },
      {
        type: 'set',
        key: 'messages.bye',
        locale: 'en',
        value: 'Bye',
      },
    ])
    expect(JSON.parse(files.get('lang/en.json')!)).toEqual({ 'Welcome back.': 'Welcome back.', 'Hi': 'Hi', 'Log in: now.': 'Log in: now.' })
    expect(JSON.parse(files.get('lang/de.json')!)).toEqual({ 'Hi': 'Hallo', 'Welcome back.': 'Willkommen zurück.' })
    expect(files.get('lang/en/messages.php')).toContain(`'bye' => 'Bye'`)
  })

  it('i18next: keySeparator and nsSeparator false in the init code', async () => {
    const { project, files } = await createTestProject({
      'package.json': JSON.stringify({
        dependencies: { 'i18next': '^23.0.0', 'react-i18next': '^14.0.0' },
      }),
      'src/i18n.ts': `i18n.init({ keySeparator: false, nsSeparator: false, defaultNS: 'common' })`,
      'locales/en/common.json': json({ 'Welcome back.': 'Welcome back.', 'Note: x': 'Note' }),
      'src/App.tsx': `function App() { const { t } = useTranslation(); return t('Welcome back.') + t('Note: x') + t('Save.') }`,
    }, {
      presets: [
        reactI18next(),
      ],
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
    })
    expect(project.config.keySeparator).toBe(false)
    expect(project.config.namespace.separator).toBe(false)
    expect(project.usages().map(m => m.usage.key)).toEqual(['common:Welcome back.', 'common:Note: x', 'common:Save.'])
    expect(project.parseKey('Note: x')).toBe('common:Note: x')
    expect(project.parseKey('common:Note: x')).toBe('common:Note: x')
    await write(project, [
      {
        type: 'set',
        key: 'common:Save.',
        locale: 'en',
        value: 'Save.',
      },
    ])
    expect(JSON.parse(files.get('locales/en/common.json')!)).toEqual({ 'Welcome back.': 'Welcome back.', 'Note: x': 'Note', 'Save.': 'Save.' })
  })

  it('python-gettext: a msgid with . and : is one key', async () => {
    const { project, files } = await createTestProject({
      'locale/de/LC_MESSAGES/django.po': 'msgid "Hello. World"\nmsgstr "Hallo. Welt"\n',
      'locale/en/LC_MESSAGES/django.po': 'msgid "Hello. World"\nmsgstr "Hello. World"\n',
      'app/views.py': `_("Hello. World")\n_("Note: done.")\n`,
    }, {
      presets: [
        pythonGettext(),
      ],
    })
    expect(project.config.keySeparator).toBe(false)
    expect(project.keys()).toEqual(['Hello. World'])
    expect(project.get('Hello. World')?.path).toEqual(['Hello. World'])
    await write(project, [
      {
        type: 'set',
        key: 'Note: done.',
        locale: 'de',
        value: 'Hinweis: fertig.',
      },
    ])
    expect(files.get('locale/de/LC_MESSAGES/django.po')).toContain('msgid "Note: done."\nmsgstr "Hinweis: fertig."')
  })
})
