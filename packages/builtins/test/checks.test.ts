import type { UserConfig } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { doubleBraces, nesting, placeholders } from '../src/placeholders'
import { createTestProject, json } from './_utils'

async function identical(source: Record<string, string>, target: Record<string, string>, config: UserConfig = {}, locale = 'de'): Promise<string[]> {
  const { project } = await createTestProject({
    'locales/en.json': json(source),
    [`locales/${locale}.json`]: json(target),
  }, {
    resources: [
      { pattern: 'locales/{locale}.json' },
    ],
    plugins: [
      placeholders(doubleBraces, nesting),
    ],
    checks: { 'identical-to-source': 'warning' },
    ...config,
  })
  return project.analyze().diagnostics.filter(d => d.code === 'identical-to-source').map(d => `${d.locale}:${d.key}`)
}

describe('identical-to-source', () => {
  it('reports at info by default', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({ save: 'Save' }),
      'locales/de.json': json({ save: 'Save' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    expect(project.analyze().diagnostics.filter(d => d.code === 'identical-to-source').map(d => [d.key, d.severity])).toEqual([
      ['save', 'info'],
    ])
  })

  it('reports a value copied from the source locale', async () => {
    const values = {
      save: 'Save',
      count: '{{count}} items',
      html: '<0>Read more</0>',
      plural: '{count, plural, one {# item} other {# items}}',
    }
    expect(await identical(values, values)).toEqual([
      'de:save',
      'de:count',
      'de:html',
      'de:plural',
    ])
    expect(await identical({ save: 'Save' }, { save: 'Speichern' })).toEqual([])
  })

  it('skips locales of the source language', async () => {
    expect(await identical({ color: 'Color' }, { color: 'Color' }, {}, 'en-GB')).toEqual([])
    expect(await identical({ color: 'Color' }, { color: 'Color' }, {}, 'en_US')).toEqual([])
  })

  it('skips values without letters once placeholders, references and tags are removed', async () => {
    const values = {
      count: '{{count}}',
      percent: '100 %',
      tag: '<0/>',
      ref: '$t(common.save)',
      mix: '{{a}} / {{b}}',
      time: '12:30',
    }
    expect(await identical(values, values)).toEqual([])
  })

  it('skips URLs and e-mail addresses', async () => {
    const values = {
      site: 'https://x18n.dev/docs',
      www: 'www.example.com',
      mail: 'hello@x18n.dev',
      mailto: 'mailto:hello@x18n.dev',
    }
    expect(await identical(values, values)).toEqual([])
  })

  it('skips short all-caps words', async () => {
    const values = {
      ok: 'OK',
      faq: 'FAQ',
      pdf: 'PDF {{size}}',
      long: 'UNSAVED',
    }
    expect(await identical(values, values)).toEqual(['de:long'])
  })

  it('skips do-not-translate glossary terms', async () => {
    const values = { name: 'x18n', other: 'Acme' }
    expect(await identical(values, values, {
      glossary: [
        { term: 'x18n', doNotTranslate: true },
        {
          term: 'Acme',
          translations: { de: 'Acme GmbH' },
        },
      ],
    })).toEqual(['de:other'])
  })
})
