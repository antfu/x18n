import { describe, expect, it } from 'vitest'
import { icu } from '../src/placeholders'

const names = (value: string): string[] => icu.find(value).map(p => p.name)

describe('icu', () => {
  it('finds simple arguments', () => {
    expect(names('Hello {name}, you have {count, number}')).toEqual(['name', 'count'])
  })

  it('does not read the text of plural, select and selectordinal cases as arguments', () => {
    expect(names('{count, plural, =0 {Vide} one {1 fichier} other {# fichiers}}')).toEqual(['count'])
    expect(names('{count, plural, =0 {Empty} one {1 file} other {# files}}')).toEqual(['count'])
    expect(names('{g, select, male {him} female {her} other {them}}')).toEqual(['g'])
    expect(names('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}')).toEqual(['n'])
    expect(names('{n, plural, offset:1 =0 {nobody} other {# others}}')).toEqual(['n'])
  })

  it('finds arguments nested inside cases', () => {
    expect(names('{n, plural, =1 {{name} left} other {{name} and # others left}}')).toEqual(['n', 'name', 'name'])
    expect(names('{g, select, male {{n, plural, one {# son} other {# sons {who}}}} other {x}}')).toEqual(['g', 'n', 'who'])
  })

  it('reports ranges of nested arguments', () => {
    const value = '{n, plural, other {hi {name}}}'
    const nested = icu.find(value)[1]!
    expect(value.slice(nested.range.start, nested.range.end)).toBe('{name}')
  })

  it('skips quoted braces', () => {
    expect(names('\'{\'literal\'}\' {name}')).toEqual(['name'])
  })
})
