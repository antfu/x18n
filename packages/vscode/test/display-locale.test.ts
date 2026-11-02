import { describe, expect, it } from 'vitest'
import { effectiveDisplayLocale } from '../src/model/display-locale'

describe('effectiveDisplayLocale', () => {
  it('prefers the workspace pick over the setting', () => {
    expect(effectiveDisplayLocale('de', 'fr')).toBe('de')
    expect(effectiveDisplayLocale('de', '')).toBe('de')
  })

  it('keeps a pick of the source locale over a set setting', () => {
    expect(effectiveDisplayLocale('', 'fr')).toBe('')
  })

  it('falls back to the setting when nothing is picked', () => {
    expect(effectiveDisplayLocale(undefined, 'fr')).toBe('fr')
    expect(effectiveDisplayLocale(undefined, '')).toBe('')
  })
})
