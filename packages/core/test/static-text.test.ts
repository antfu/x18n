import type { LiteralSyntax, Placeholder, PlaceholderSyntax } from '@x18n/core'
import { renderMessageText, resolveStaticText } from '@x18n/core'
import { describe, expect, it } from 'vitest'

/** A quoted literal, shaped like the vue-i18n one, so the rules stay readable here. */
const quoted: LiteralSyntax = {
  id: 'quoted',
  find(value) {
    return [
      ...value.matchAll(/\{'([^']*)'\}/g),
    ].map(match => ({
      syntax: 'quoted',
      text: match[0],
      value: match[1]!,
      range: { start: match.index, end: match.index + match[0].length },
    }))
  },
}

const syntax = {
  literals: [quoted],
  reserved: '@{}',
}
/** `{name}`, the shape of a named interpolation. */
const placeholders: readonly PlaceholderSyntax[] = [
  {
    id: 'braces',
    find: value => [
      ...value.matchAll(/\{\s*([\w.-]+)\s*\}/g),
    ].map(match => ({
      syntax: 'braces',
      text: match[0],
      name: match[1]!,
      range: { start: match.index, end: match.index + match[0].length },
    })),
  },
]

function resolve(value: string, reserved = '@{}'): string | undefined {
  return resolveStaticText({
    value,
    syntax: { ...syntax, reserved },
    placeholders,
  })?.value
}

/** `{name}` reads a param named in `table`, the way a surface fills a call's static params. */
function text(value: string, table: Record<string, string> = {}): string {
  return renderMessageText({
    value,
    syntax,
    placeholders,
    placeholder: (placeholder: Placeholder) => table[placeholder.name],
  })
}

describe('renderMessageText', () => {
  it('decodes a literal', () => {
    expect(text('hello{\'@\'}example.com')).toBe('hello@example.com')
    expect(text('a{\'|\'}b')).toBe('a|b')
  })

  it('fills a placeholder it can resolve and keeps the rest', () => {
    expect(text('Hello {name}!', { name: 'Ada' })).toBe('Hello Ada!')
    expect(text('{first} {last}', { first: 'Ada' })).toBe('Ada {last}')
    expect(text('Hello {name}!')).toBe('Hello {name}!')
    expect(text('one | other')).toBe('one | other')
  })

  it('keeps the text a literal decodes to, even when it looks like a placeholder', () => {
    expect(text('{\'{\'}name{\'}\'}', { name: 'Ada' })).toBe('{name}')
    expect(text('hello {\'{}\'}', { name: 'Ada' })).toBe('hello {}')
  })

  it('returns a value whose literals overlap as written', () => {
    const overlapping: LiteralSyntax = {
      id: 'overlap',
      find: () => [
        {
          syntax: 'overlap',
          text: 'ab',
          value: 'x',
          range: { start: 0, end: 2 },
        },
        {
          syntax: 'overlap',
          text: 'bc',
          value: 'y',
          range: { start: 1, end: 3 },
        },
      ],
    }
    expect(renderMessageText({
      value: 'abc',
      syntax: {
        literals: [overlapping],
      },
      placeholders: [],
    })).toBe('abc')
  })
})

describe('resolveStaticText', () => {
  it('returns plain text as written', () => {
    expect(resolve('Hello world')).toBe('Hello world')
    expect(resolve('It\'s & <b>fine</b>')).toBe('It\'s & <b>fine</b>')
    expect(resolve('100% done')).toBe('100% done')
  })

  it('decodes a literal', () => {
    expect(resolve('hello{\'@\'}example.com')).toBe('hello@example.com')
    expect(resolve('a{\'@\'}b{\'@\'}c')).toBe('a@b@c')
    expect(resolve('{\'@\'}')).toBe('@')
  })

  it('leaves a value that needs runtime input alone', () => {
    expect(resolve('')).toBeUndefined()
    expect(resolve('Hello {name}')).toBeUndefined()
  })

  it('rejects the reserved characters of the syntax', () => {
    // A bare `|` is a plural list only where the syntax says so, as vue-i18n does.
    expect(resolve('one | other')).toBe('one | other')
    expect(resolve('one | other', '@{}|')).toBeUndefined()
    expect(resolve('a{\'|\'}b | c', '@{}|')).toBeUndefined()
    expect(resolve('a{\'|\'}b')).toBe('a|b')
  })

  it('rejects a reserved character outside a literal', () => {
    expect(resolve('hello@example.com')).toBeUndefined()
    expect(resolve('a{b')).toBeUndefined()
    expect(resolve('a}b')).toBeUndefined()
    expect(resolve('@:other')).toBeUndefined()
  })

  it('accepts a reserved character inside a literal', () => {
    expect(resolve('a{\'|\'}b')).toBe('a|b')
    expect(resolve('a{\'{}\'}b')).toBe('a{}b')
  })

  it('keeps the reserved characters of a syntax without any', () => {
    expect(resolve('hello@example.com', '')).toBe('hello@example.com')
  })

  it('decodes nothing when two literal spans overlap', () => {
    const overlapping: LiteralSyntax = {
      id: 'overlap',
      find: () => [
        {
          syntax: 'overlap',
          text: 'ab',
          value: 'x',
          range: { start: 0, end: 2 },
        },
        {
          syntax: 'overlap',
          text: 'bc',
          value: 'y',
          range: { start: 1, end: 3 },
        },
      ],
    }
    expect(resolveStaticText({
      value: 'abc',
      syntax: {
        literals: [overlapping],
      },
      placeholders: [],
    })).toBeUndefined()
  })

  it('ignores a placeholder inside a literal', () => {
    const literal: LiteralSyntax = {
      id: 'quoted',
      find: value => value.startsWith('\'{name}\'')
        ? [
            {
              syntax: 'quoted',
              text: '\'{name}\'',
              value: '{name}',
              range: { start: 0, end: 8 },
            },
          ]
        : [],
    }
    expect(resolveStaticText({
      value: '\'{name}\' tail',
      syntax: {
        literals: [literal],
      },
      placeholders,
    })).toEqual({ value: '{name} tail' })
  })
})
