import type { PlaceholderSyntax } from '@x18n/core'
import { braces, icu, linked, nesting, percentBraces } from '@x18n/builtins/placeholders'
import { renderMessageText } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { paramText } from '../src/fill'

/** A value as a surface shows it: the placeholders a call resolves filled in, the rest as written. */
function fill(value: string, params: Record<string, string> | undefined, syntaxes: readonly PlaceholderSyntax[]): string {
  return renderMessageText({
    value,
    syntax: {},
    placeholders: syntaxes,
    placeholder: paramText(params, syntaxes),
  })
}

describe('paramText', () => {
  it('fills simple placeholders with static params', () => {
    expect(fill('Hello {name}!', { name: 'Ada' }, [braces])).toBe('Hello Ada!')
    expect(fill('{first} {last}', { first: 'Ada', last: 'Lovelace' }, [braces])).toBe('Ada Lovelace')
    expect(fill('{name}, {name}', { name: 'Ada' }, [braces])).toBe('Ada, Ada')
  })

  it('keeps unknown params and formatted arguments as written', () => {
    expect(fill('Hello {name}!', {}, [braces])).toBe('Hello {name}!')
    expect(fill('Hello {name}!', undefined, [braces])).toBe('Hello {name}!')
    expect(fill('{count, plural, one {# item} other {# items}}', { count: '2' }, [icu])).toBe('{count, plural, one {# item} other {# items}}')
    expect(fill('{count, number}', { count: '2' }, [icu])).toBe('{count, number}')
  })

  it('keeps reference syntax as written', () => {
    expect(fill('See @:greeting', { greeting: 'Hi' }, [braces, linked])).toBe('See @:greeting')
    expect(fill('$t(greeting)', { greeting: 'Hi' }, [braces, nesting])).toBe('$t(greeting)')
  })

  it('fills once across overlapping syntaxes', () => {
    expect(fill('Hello {name}!', { name: 'Ada' }, [braces, icu])).toBe('Hello Ada!')
    expect(fill('%{name}', { name: 'Ada' }, [braces, percentBraces])).toBe('Ada')
  })
})
