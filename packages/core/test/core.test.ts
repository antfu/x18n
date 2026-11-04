import { describe, expect, it } from 'vitest'
import { applyTextEdits, createLineIndex, createMemoryHost, diffText, globToRegExp, isKeyUnder, isMessageTree, joinKey, keyMatcher, parseLocaleInfo, splitKey } from '../src'

describe('keys', () => {
  it('joins and splits keys with namespaces', () => {
    expect(joinKey('common', ['a', 'b'])).toBe('common:a.b')
    expect(joinKey(undefined, ['a', 'b'])).toBe('a.b')
    expect(splitKey('common:a.b')).toEqual({
      namespace: 'common',
      path: ['a', 'b'],
    })
    expect(splitKey('Note: x', false)).toEqual({
      namespace: undefined,
      path: ['Note: x'],
    })
  })

  it('knows subtrees', () => {
    expect(isKeyUnder('pages.home', 'pages')).toBe(true)
    expect(isKeyUnder('pagesX', 'pages')).toBe(false)
    expect(isKeyUnder('ns:a', 'ns:')).toBe(true)
  })

  it('matches key globs per segment', () => {
    const match = keyMatcher(['pages.*', 'deep.**'])
    expect(match('pages.home')).toBe(true)
    expect(match('pages.home.title')).toBe(false)
    expect(match('deep.a.b.c')).toBe(true)
  })

  it('matches regular expressions against the whole key', () => {
    const match = keyMatcher([/^errors\.billing\.(free|premium)\.failed$/, 'a11y.**'])
    expect(match('errors.billing.free.failed')).toBe(true)
    expect(match('errors.billing.plus.failed')).toBe(false)
    expect(match('a11y.skip.link')).toBe(true)
    // `g` would make `test` remember `lastIndex` between keys.
    const global = keyMatcher([/^placeholders\./g])
    expect(global('placeholders.city')).toBe(true)
    expect(global('placeholders.email')).toBe(true)
  })

  it('keeps literal keys whole with keySeparator false', () => {
    expect(splitKey('common:Note: x.y', true, false)).toEqual({
      namespace: 'common',
      path: ['Note: x.y'],
    })
    expect(splitKey('欢迎回来。', false, false).path).toEqual(['欢迎回来。'])
    expect(splitKey('a_b.c', false, '_').path).toEqual(['a', 'b.c'])
    expect(joinKey('ns', ['a', 'b'], '_')).toBe('ns:a_b')
    expect(joinKey(undefined, ['Welcome back.'], false)).toBe('Welcome back.')
    expect(isKeyUnder('Welcome back.', 'Welcome back', false)).toBe(false)
    expect(isKeyUnder('a.b', 'a', false)).toBe(false)
    expect(isKeyUnder('ns:Note: x', 'ns:', false)).toBe(true)
    expect(isKeyUnder('a_b', 'a', '_')).toBe(true)
    const literal = keyMatcher(['Welcome *'], false)
    expect(literal('Welcome back. Again.')).toBe(true)
    expect(keyMatcher(['a_*'], '_')('a_b_c')).toBe(false)
  })

  it('matches path globs', () => {
    expect(globToRegExp('**/*.{ts,vue}').test('src/a/b.vue')).toBe(true)
    expect(globToRegExp('**/*.{ts,vue}').test('b.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false)
  })
})

describe('text', () => {
  it('diffs to one minimal edit', () => {
    const before = '{\n  "a": "x",\n  "b": "y"\n}\n'
    const after = '{\n  "a": "z",\n  "b": "y"\n}\n'
    const edits = diffText(before, after)
    expect(edits).toEqual([
      {
        range: { start: 10, end: 11 },
        text: 'z',
      },
    ])
    expect(applyTextEdits(before, edits)).toBe(after)
  })

  it('maps offsets to lines', () => {
    const index = createLineIndex('ab\ncd\n')
    expect(index.position(4)).toEqual({ line: 1, character: 1 })
    expect(index.offset({ line: 1, character: 1 })).toBe(4)
    expect(index.line(1)).toBe('cd')
  })
})

describe('locale info', () => {
  it('parses codes leniently without changing them', () => {
    expect(parseLocaleInfo('pt-BR')).toMatchObject({
      code: 'pt-BR',
      language: 'pt',
      region: 'BR',
      displayName: 'Brazilian Portuguese',
    })
    expect(parseLocaleInfo('de').flag).toBe('🇩🇪')
    expect([parseLocaleInfo('zh-Hans').flag, parseLocaleInfo('zh-Hant').flag]).toEqual(['🇨🇳', '🇹🇼'])
    expect(parseLocaleInfo('ru').pluralCategories).toEqual(['one', 'few', 'many', 'other'])
    expect(parseLocaleInfo('en').ordinalCategories).toEqual(['one', 'two', 'few', 'other'])
    expect(parseLocaleInfo('not a code')).toMatchObject({ code: 'not a code', language: undefined })
  })

  it('requires only the plural categories whole numbers select', () => {
    const categories = (code: string): [readonly string[], readonly string[]] => {
      const info = parseLocaleInfo(code)
      return [info.pluralCategories, info.requiredPluralCategories]
    }
    expect(categories('en')).toEqual([
      ['one', 'other'],
      ['one', 'other'],
    ])
    // French `many` starts at 1,000,000; Czech `many` is for fractions.
    expect(categories('fr')).toEqual([
      ['one', 'many', 'other'],
      ['one', 'other'],
    ])
    expect(categories('cs')).toEqual([
      ['one', 'few', 'many', 'other'],
      ['one', 'few', 'other'],
    ])
    expect(categories('ru')).toEqual([
      ['one', 'few', 'many', 'other'],
      ['one', 'few', 'many', 'other'],
    ])
    expect(categories('ar')).toEqual([
      [
        'zero',
        'one',
        'two',
        'few',
        'many',
        'other',
      ],
      [
        'zero',
        'one',
        'two',
        'few',
        'many',
        'other',
      ],
    ])
    expect(parseLocaleInfo('xx').requiredPluralCategories).toEqual(['other'])
    expect(parseLocaleInfo('not a code').requiredPluralCategories).toEqual(['other'])
    expect(parseLocaleInfo('en').requiredOrdinalCategories).toEqual(['one', 'two', 'few', 'other'])
  })
})

describe('isMessageTree', () => {
  it('accepts nested objects of leaves only', () => {
    expect(isMessageTree({
      a: 'x',
      b: { c: 1, d: null, e: true },
    })).toBe(true)
    expect(isMessageTree(['a'])).toBe(false)
    expect(isMessageTree({
      a: ['x'],
    })).toBe(false)
  })
})

describe('createMemoryHost', () => {
  it('reads, writes, deletes and globs', async () => {
    const host = createMemoryHost({ 'en.json': '{}', 'src/a.ts': '' })
    await host.writeFile('de.json', '{"a":"b"}')
    expect(await host.readFile('de.json')).toBe('{"a":"b"}')
    expect(await host.glob(['*.json'])).toEqual(['de.json', 'en.json'])
    await host.deleteFile('de.json')
    expect(await host.readFile('de.json')).toBeUndefined()
  })
})
