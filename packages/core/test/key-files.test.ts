import type { EditOp, MessageTree, Plugin, Project, UserConfig } from '../src'
import { describe, expect, it } from 'vitest'
import { applyMessageOps, createMemoryHost, createProject, resolveConfig } from '../src'

const localeOf = /^store\/([^/]+)\//

function serialize(tree: MessageTree): string {
  const entries = Object.entries(tree)
  if (entries.length > 1)
    throw new Error('a record holds one key')
  const [hash, text] = entries[0] ?? []
  return `${JSON.stringify({ hash, text })}\n`
}

const records: Plugin = {
  name: 'records',
  localeFinders: [
    {
      id: 'records',
      find: async ({ host }) => (await host.glob(['store/**/*.json'])).map(path => ({
        path,
        locale: localeOf.exec(path)![1]!,
        namespace: undefined,
        format: 'record',
      })),
      resolveKey: ({ key, locale }) => ({ path: `store/${locale}/${key}.json`, format: 'record' }),
    },
  ],
  formats: [
    {
      id: 'record',
      extensions: ['record'],
      parse: (text) => {
        const { hash, text: value } = JSON.parse(text) as { hash?: string, text?: string }
        return {
          tree: hash === undefined
            ? {}
            : { [hash]: value ?? '' },
        }
      },
      edit: (text, ops) => {
        const { hash, text: value } = JSON.parse(text) as { hash: string, text: string }
        return [
          {
            range: { start: 0, end: text.length },
            text: serialize(applyMessageOps({ [hash]: value }, ops)),
          },
        ]
      },
      serialize,
    },
  ],
}

const record = (hash: string, text: string): string => `${JSON.stringify({ hash, text })}\n`

async function setup(files: Record<string, string>, config: UserConfig = {}): Promise<{ project: Project, files: Map<string, string> }> {
  const host = createMemoryHost(files)
  const project = createProject({
    host,
    setup: await resolveConfig({
      host,
      config,
      builtins: {
        plugins: [records],
        presets: {},
      },
    }),
  })
  await project.ready
  return { project, files: host.files }
}

async function write(project: Project, ops: readonly EditOp[]): Promise<ReturnType<Project['plan']>> {
  const plan = project.plan(ops)
  await project.apply(plan)
  return plan
}

describe('key files', () => {
  it('puts a new message in the file the finder gives its key', async () => {
    const { project, files } = await setup({
      'store/en/a1.json': record('a1', 'Hello'),
      'store/en/b2.json': record('b2', 'World'),
      'store/fr/a1.json': record('a1', 'Bonjour'),
    })
    const plan = await write(project, [
      {
        type: 'set',
        key: 'b2',
        locale: 'fr',
        value: 'Monde',
      },
    ])
    expect(plan.changes.map(c => `${c.type}:${c.path}`)).toEqual(['create:store/fr/b2.json'])
    expect(files.get('store/fr/b2.json')).toBe(record('b2', 'Monde'))
    expect(files.get('store/fr/a1.json')).toBe(record('a1', 'Bonjour'))
    expect(project.message('b2', 'fr')?.resource).toBe('store/fr/b2.json')
    await write(project, [
      {
        type: 'set',
        key: 'b2',
        locale: 'fr',
        value: 'Le monde',
      },
    ])
    expect(files.get('store/fr/b2.json')).toBe(record('b2', 'Le monde'))
  })

  it('gives the empty values of `keepFilled` their own files', async () => {
    const { project } = await setup({
      'store/en/a1.json': record('a1', 'Hello'),
      'store/fr/a1.json': record('a1', 'Bonjour'),
    }, {
      write: { keepFilled: true },
    })
    const plan = project.plan([
      {
        type: 'set',
        key: 'b2',
        locale: 'en',
        value: 'World',
      },
    ])
    expect(plan.changes.map(c => `${c.type}:${c.path}`)).toEqual(['create:store/en/b2.json', 'create:store/fr/b2.json'])
  })

  it('moves a renamed key to its own file and removes the old one', async () => {
    const { project, files } = await setup({
      'store/en/a1.json': record('a1', 'Hello'),
      'store/fr/a1.json': record('a1', 'Bonjour'),
    })
    const plan = await write(project, [
      { type: 'rename', from: 'a1', to: 'c3' },
    ])
    expect(plan.changes.map(c => `${c.type}:${c.path}`).sort()).toEqual([
      'create:store/en/c3.json',
      'create:store/fr/c3.json',
      'delete:store/en/a1.json',
      'delete:store/fr/a1.json',
    ])
    expect([
      ...files.keys(),
    ].sort()).toEqual(['store/en/c3.json', 'store/fr/c3.json'])
    expect(project.message('c3', 'fr')?.value).toBe('Bonjour')
  })

  it('moves a key duplicated in one locale once, keeping the value that wins', async () => {
    const { project, files } = await setup({
      'store/en/a1.json': record('a1', 'Hello'),
      'store/en/copy.json': record('a1', 'Copy'),
    })
    const winner = project.message('a1', 'en')!
    const plan = await write(project, [
      { type: 'rename', from: 'a1', to: 'c3' },
    ])
    expect(files.has('store/en/a1.json')).toBe(false)
    expect(files.get('store/en/c3.json')).toBe(record('c3', String(winner.value)))
    expect(project.message('c3', 'en')?.value).toBe(winner.value)
    expect(project.message('a1', 'en')).toBeUndefined()
    expect(plan.warnings).toEqual([
      `Copies of "a1" in en have different values; "c3" keeps the one from ${winner.resource}.`,
    ])
  })

  it('deletes the file of a deleted key', async () => {
    const { project, files } = await setup({
      'store/en/a1.json': record('a1', 'Hello'),
      'store/en/b2.json': record('b2', 'World'),
      'store/fr/a1.json': record('a1', 'Bonjour'),
      'store/fr/b2.json': record('b2', 'Monde'),
    })
    const plan = await write(project, [
      {
        type: 'delete',
        key: 'a1',
        locales: ['fr'],
      },
    ])
    expect(plan.changes).toEqual([
      { type: 'delete', path: 'store/fr/a1.json' },
    ])
    expect(files.has('store/fr/a1.json')).toBe(false)
    expect(project.get('a1')?.missing).toEqual(['fr'])
  })
})
