import { describe, expect, it } from 'vitest'
import { folderIds, treeRows } from '../app/key-tree'

const keys = [
  'app.title',
  'app.nav.home',
  'app.nav.about',
  'app',
  'common:save',
]

describe('key tree', () => {
  it('folds keys into folders, a folder that is a key keeps both', () => {
    const rows = treeRows(keys, new Set())
    expect(rows.map(r => [r.label, r.depth, r.branch, r.key])).toEqual([
      ['app', 0, true, 'app'],
      ['common', 0, true, undefined],
    ])
  })

  it('lists the children of open folders, sorted', () => {
    const rows = treeRows(keys, new Set(['app', 'app.nav']))
    expect(rows.map(r => `${'  '.repeat(r.depth)}${r.label}`)).toEqual([
      'app',
      '  nav',
      '    about',
      '    home',
      '  title',
      'common',
    ])
    expect(rows.find(r => r.label === 'nav')).toMatchObject({ id: 'app.nav', key: undefined, open: true })
  })

  it('opens everything on request and splits namespaces', () => {
    const rows = treeRows(keys, new Set(), true)
    expect(rows.find(r => r.label === 'save')).toMatchObject({ id: 'common:save', key: 'common:save', depth: 1 })
  })

  it('shows and sorts keys by their labels', () => {
    const rows = treeRows(['3f2a', '9b1c', 'a07e'], new Set(), false, new Map([
      ['9b1c', 'intro.md > Server engine'],
      ['a07e', 'intro.md > Install'],
    ]))
    expect(rows.map(r => [r.label, r.key])).toEqual([
      ['3f2a', '3f2a'],
      ['intro.md > Install', 'a07e'],
      ['intro.md > Server engine', '9b1c'],
    ])
  })

  it('names the folders that hold a key', () => {
    expect(folderIds('app.nav.home')).toEqual(['app', 'app.nav'])
    expect(folderIds('common:save')).toEqual(['common'])
    expect(folderIds('title')).toEqual([])
  })
})
