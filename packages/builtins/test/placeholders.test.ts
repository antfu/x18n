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

  it('skips quoted braces inside cases', () => {
    expect(names('{count, plural, one {\'{\' # item} other {# items}}')).toEqual(['count'])
    expect(names('{n, plural, one {\'}\' {name}} other {# {name}}}')).toEqual(['n', 'name', 'name'])
  })

  it('reads doubled apostrophes as apostrophes', () => {
    expect(names('{n, plural, other {\'{it\'\'s}\' {name}}}')).toEqual(['n', 'name'])
    expect(names('it\'\'{name}')).toEqual(['name'])
  })

  it('stops at an unclosed quote', () => {
    expect(names('{name} \'{ {other}')).toEqual(['name'])
  })
})

describe('icu validate', () => {
  const validate = (value: string): readonly string[] => icu.validate!(value)

  it('accepts quoted braces and doubled apostrophes', () => {
    expect(validate('\'{\' {name} \'}\'')).toEqual([])
    expect(validate('{count, plural, one {\'{\' # item} other {# items}}')).toEqual([])
    expect(validate('{n, plural, other {\'{it\'\'s}\' {name}}}')).toEqual([])
    expect(validate('it\'\'s {name}')).toEqual([])
  })

  it('reports unbalanced braces', () => {
    expect(validate('a } b')).toEqual(['Unexpected "}" at 2'])
    expect(validate('{name')).toEqual(['Unclosed "{"'])
    expect(validate('it\'\'{name')).toEqual(['Unclosed "{"'])
  })

  it('reports a plural without an other case', () => {
    expect(validate('{n, plural, one {x}}')).toEqual(['"n" plural has no "other" case'])
  })
})
