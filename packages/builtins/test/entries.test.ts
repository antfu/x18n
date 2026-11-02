import { describe, expect, it } from 'vitest'
import { formats } from '../src/formats'
import { presets } from '../src/presets'
import { scanners } from '../src/scanners'
import html from '../src/scanners/html/entry'

describe('entries match their modules', () => {
  it.each(Object.entries(formats))('format %s', async (id, entry) => {
    const format = (await entry.load()).default().formats?.find(item => item.id === id)
    expect(format?.extensions).toEqual(entry.extensions)
  })

  it.each([
    ...Object.entries(scanners),
    // Listed by the Angular presets, not by the map.
    ['html', html] as const,
  ])('scanner %s', async (id, entry) => {
    const scanner = (await entry.load()).default().scanners?.find(item => item.id === id)
    expect(scanner?.extensions).toEqual(entry.extensions)
  })

  it.each(Object.entries(presets))('preset %s', async (name, entry) => {
    const preset = (await entry.load()).default()
    expect(preset.name).toBe(name)
    expect(preset.detect).toBeUndefined()
    expect(preset.exclusive).toBeUndefined()
  })
})
