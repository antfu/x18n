import { braces, icu, linked, nesting, percentBraces } from '@x18n/builtins/placeholders'
import { describe, expect, it } from 'vitest'
import { fillParams } from '../src/fill'

describe('fillParams', () => {
  it('replaces simple placeholders with static params', () => {
    expect(fillParams('Hello {name}!', { name: 'Ada' }, [braces])).toBe('Hello Ada!')
    expect(fillParams('{first} {last}', { first: 'Ada', last: 'Lovelace' }, [braces])).toBe('Ada Lovelace')
    expect(fillParams('{name}, {name}', { name: 'Ada' }, [braces])).toBe('Ada, Ada')
  })

  it('leaves unknown params and formatted arguments alone', () => {
    expect(fillParams('Hello {name}!', {}, [braces])).toBe('Hello {name}!')
    expect(fillParams('Hello {name}!', undefined, [braces])).toBe('Hello {name}!')
    expect(fillParams('{count, plural, one {# item} other {# items}}', { count: '2' }, [icu])).toBe('{count, plural, one {# item} other {# items}}')
    expect(fillParams('{count, number}', { count: '2' }, [icu])).toBe('{count, number}')
  })

  it('leaves reference syntax alone', () => {
    expect(fillParams('See @:greeting', { greeting: 'Hi' }, [braces, linked])).toBe('See @:greeting')
    expect(fillParams('$t(greeting)', { greeting: 'Hi' }, [braces, nesting])).toBe('$t(greeting)')
  })

  it('fills once across overlapping syntaxes', () => {
    expect(fillParams('Hello {name}!', { name: 'Ada' }, [braces, icu])).toBe('Hello Ada!')
    expect(fillParams('%{name}', { name: 'Ada' }, [braces, percentBraces])).toBe('Ada')
  })
})
