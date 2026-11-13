import { describe, expect, it } from 'vitest'
import { createTestProject, json } from './_utils'

/**
 * The decoded values follow `@intlify/core` 11.4 as the oracle: a quoted literal and a text escape
 * decode, a bare `@` or brace is syntax, and a bare `|` splits plural forms.
 */
describe('static text', () => {
  it('decodes the literals and escapes of a vue-i18n message', async () => {
    const { project } = await createTestProject({
      'package.json': json({
        dependencies: { 'vue-i18n': '*' },
      }),
      'locales/en.json': json({
        mail: 'hello{\'@\'}example.com',
        escape: 'hello\\@example.com',
        brace: 'a{\'{\'}b',
        quoted: 'say {\'"\'}hi{\'"\'}',
        pipe: 'a{\'|\'}b',
        spaced: 'a{ \'@\' }b',
        unicode: 'a{\'\\u0041\'}b',
        backslash: 'a{\'\\\\\'}b',
      }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    expect(project.staticText('mail', 'en')).toEqual({ value: 'hello@example.com' })
    expect(project.staticText('escape', 'en')).toEqual({ value: 'hello@example.com' })
    expect(project.staticText('brace', 'en')).toEqual({ value: 'a{b' })
    expect(project.staticText('quoted', 'en')).toEqual({ value: 'say "hi"' })
    expect(project.staticText('pipe', 'en')).toEqual({ value: 'a|b' })
    expect(project.staticText('spaced', 'en')).toEqual({ value: 'a@b' })
    expect(project.staticText('unicode', 'en')).toEqual({ value: 'aAb' })
    expect(project.staticText('backslash', 'en')).toEqual({ value: 'a\\b' })
  })

  it('leaves a value that needs runtime input or an undecoded literal alone', async () => {
    const { project } = await createTestProject({
      'package.json': json({
        dependencies: { 'vue-i18n': '*' },
      }),
      'locales/en.json': json({
        linked: '@:plain',
        param: 'hi {name}',
        plural: 'one | other',
        bare: 'hello@example.com',
        outOfRange: 'a{\'\\UFFFFFF\'}b',
      }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    for (const key of [
      'linked',
      'param',
      'plural',
      'bare',
      'outOfRange',
    ])
      expect(project.staticText(key, 'en')).toBeUndefined()
  })

  it('keeps the text of a project whose syntax has no literals', async () => {
    const { project } = await createTestProject({
      'package.json': json({
        dependencies: { i18next: '*' },
      }),
      'locales/en.json': json({
        mail: 'hello@example.com',
        param: 'hi {{name}}',
        plural: 'one | other',
      }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    expect(project.staticText('mail', 'en')).toEqual({ value: 'hello@example.com' })
    expect(project.staticText('param', 'en')).toBeUndefined()
    // i18next plurals are derived keys, not a `|` list, and its preset reserves no character.
    expect(project.staticText('plural', 'en')).toEqual({ value: 'one | other' })
  })
})
