import type { PickState } from '../src/model/display-locale'
import { describe, expect, it } from 'vitest'
import { displayLocaleKey, displayLocalePick, effectiveDisplayLocale } from '../src/model/display-locale'

function memento(initial: Record<string, unknown> = {}): PickState & { readonly values: Map<string, unknown> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => {
      if (value === undefined)
        values.delete(key)
      else
        values.set(key, value)
    },
  }
}

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

describe('displayLocalePick', () => {
  it('reads and stores the pick in the workspace state', async () => {
    const state = memento({ [displayLocaleKey]: 'de' })
    const pick = displayLocalePick(state)
    expect(pick.current()).toBe('de')
    await pick.pick('')
    expect(pick.current()).toBe('')
    expect(state.values.get(displayLocaleKey)).toBe('')
    await pick.pick(undefined)
    expect(pick.current()).toBeUndefined()
    expect(state.values.has(displayLocaleKey)).toBe(false)
  })

  it('clears the pick when the setting changes, so the edited setting applies', async () => {
    const state = memento({ [displayLocaleKey]: 'de' })
    const pick = displayLocalePick(state)
    await pick.settingChanged()
    expect(pick.current()).toBeUndefined()
    expect(state.values.has(displayLocaleKey)).toBe(false)
    expect(effectiveDisplayLocale(pick.current(), 'fr')).toBe('fr')
  })

  it('leaves the state alone when nothing was picked', async () => {
    const state = memento()
    let writes = 0
    const pick = displayLocalePick({
      ...state,
      update: async (key, value) => {
        writes++
        await state.update(key, value)
      },
    })
    await pick.settingChanged()
    expect(writes).toBe(0)
  })
})
