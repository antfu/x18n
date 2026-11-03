import type { MessageState, MessageTree, Plugin, Project } from '../src'
import { describe, expect, it } from 'vitest'
import { createMemoryHost, createProject, pathId, resolveConfig } from '../src'

interface Entry {
  readonly text: string
  readonly state?: MessageState
  readonly label?: string
}

const store: Plugin = {
  name: 'store',
  localeFinders: [
    {
      id: 'store',
      find: async ({ host }) => (await host.glob(['store/*.json'])).map(path => ({
        path,
        locale: path.slice('store/'.length, -'.json'.length),
        namespace: undefined,
        format: 'store',
      })),
    },
  ],
  formats: [
    {
      id: 'store',
      extensions: ['store'],
      parse: (text) => {
        const entries = (JSON.parse(text) as { messages: Record<string, Entry> }).messages
        const tree: Record<string, string> = {}
        const states = new Map<string, MessageState>()
        const labels = new Map<string, string>()
        for (const [key, entry] of Object.entries(entries)) {
          tree[key] = entry.text
          if (entry.state)
            states.set(pathId(['messages', key]), entry.state)
          if (entry.label)
            labels.set(pathId(['messages', key]), entry.label)
        }
        return {
          tree: { messages: tree },
          states,
          labels,
        }
      },
    },
  ],
  transformResource: {
    read: tree => tree.messages as MessageTree,
    toStored: path => ['messages', ...path],
  },
}

async function setup(files: Record<string, object>): Promise<Project> {
  const host = createMemoryHost(Object.fromEntries(Object.entries(files).map(([path, value]) => [
    path,
    JSON.stringify(value),
  ])))
  const project = createProject({
    host,
    setup: await resolveConfig({
      host,
      config: {},
      builtins: {
        plugins: [store],
        presets: {},
      },
    }),
  })
  await project.ready
  return project
}

describe('message states and labels', () => {
  it('carries what the format reads onto messages, keys and coverage', async () => {
    const project = await setup({
      'store/en.json': {
        messages: {
          a1: { text: 'Server engine', label: 'intro.md > Server engine' },
          b2: { text: 'Routing' },
          c3: { text: 'Data' },
          d4: { text: 'Hooks' },
        },
      },
      'store/fr.json': {
        messages: {
          a1: { text: 'Moteur serveur', state: 'reviewed' },
          b2: { text: 'Routage', state: 'needs-review', label: 'routing.md' },
          c3: { text: 'Données', state: 'translated' },
        },
      },
    })
    expect(project.message('a1', 'fr')?.state).toBe('reviewed')
    expect(project.message('a1', 'en')?.state).toBeUndefined()
    expect(project.get('a1')?.label).toBe('intro.md > Server engine')
    expect(project.get('b2')?.label).toBe('routing.md')
    expect(project.get('c3')?.label).toBeUndefined()
    const fr = project.analyze().coverage.find(c => c.locale === 'fr')!
    expect(fr).toMatchObject({
      translated: 3,
      missing: ['d4'],
      needsReview: ['b2'],
      reviewed: ['a1'],
    })
  })
})
