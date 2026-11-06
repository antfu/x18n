import type { Workspace } from '@x18n/node'
import type { DevframeNodeContext } from 'devframe'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadWorkspace } from '@x18n/node'
import { createX18nDevframe } from '@x18n/ui'
import { createHostContext } from 'devframe/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const fixtures = fileURLToPath(new URL('../../../test/fixtures/', import.meta.url))
let root: string
let workspace: Workspace
let ctx: DevframeNodeContext
let project: string

/** What the client receives: JSON drops `undefined` fields. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

beforeAll(async () => {
  // A fixed directory name keeps the project name (and the snapshots) stable.
  root = join(await mkdtemp(join(tmpdir(), 'x18n-ui-')), 'vue-i18n')
  await cp(join(fixtures, 'vue-i18n'), root, { recursive: true })
  workspace = await loadWorkspace({ cwd: root, cache: false })
  project = workspace.projects[0]!.name
  ctx = await createHostContext({
    cwd: root,
    mode: 'dev',
    host: {
      mountStatic: () => {},
      resolveOrigin: () => 'http://localhost',
      getStorageDir: () => join(root, '.devframe'),
    },
  })
  await createX18nDevframe(workspace.projects).setup(ctx)
})

afterAll(async () => {
  workspace.projects.forEach(p => p.project.dispose())
  await rm(join(root, '..'), { recursive: true, force: true })
})

describe('rpc functions', () => {
  it('summarizes projects', async () => {
    expect(wire(await ctx.rpc.invokeLocal('x18n:project'))).toMatchSnapshot()
  })

  it('lists keys with values and flags', async () => {
    expect(wire(await ctx.rpc.invokeLocal('x18n:keys', { project }))).toMatchSnapshot()
  })

  it('details one key with usages and diagnostics', async () => {
    expect(wire(await ctx.rpc.invokeLocal('x18n:key', { project, key: 'app.greeting' }))).toMatchSnapshot()
    expect(await ctx.rpc.invokeLocal('x18n:key', { project, key: 'nope' })).toBeNull()
  })

  it('lists usages and the analysis', async () => {
    expect(wire(await ctx.rpc.invokeLocal('x18n:usages', { project }))).toMatchSnapshot()
    expect(wire(await ctx.rpc.invokeLocal('x18n:analysis', { project }))).toMatchSnapshot()
  })

  it('pages diagnostics, errors first, filtered by code and locale', async () => {
    const all = await ctx.rpc.invokeLocal('x18n:diagnostics', { project, page: 0 })
    expect(wire(all)).toMatchSnapshot()
    expect(all.total).toBe(all.byCode.reduce((sum, c) => sum + c.count, 0))
    expect(all.items.length).toBe(Math.min(all.total, all.pageSize))
    const severities = all.items.map(d => d.severity === 'error')
    expect(severities).toEqual(severities.toSorted((a, b) => Number(b) - Number(a)))

    const code = all.byCode[0]!.code
    const byCode = await ctx.rpc.invokeLocal('x18n:diagnostics', {
      project,
      codes: [code],
      page: 0,
    })
    expect(byCode.total).toBe(all.byCode[0]!.count)
    expect(byCode.items.every(d => d.code === code)).toBe(true)
    // Counts stay those of every code, so the page can offer the others.
    expect(byCode.byCode).toEqual(all.byCode)

    const locale = all.items.find(d => d.locale !== undefined)!.locale!
    const inLocale = await ctx.rpc.invokeLocal('x18n:diagnostics', { project, locale, page: 0 })
    expect(inLocale.items.length).toBeGreaterThan(0)
    expect(inLocale.items.every(d => d.locale === locale)).toBe(true)

    const past = await ctx.rpc.invokeLocal('x18n:diagnostics', { project, page: 1 })
    expect(past.items).toEqual([])
    expect(past.total).toBe(all.total)
    await expect(ctx.rpc.invokeLocal('x18n:diagnostics', { project, page: -1 })).rejects.toThrow()
  })

  it('explains the project', async () => {
    expect(wire(await ctx.rpc.invokeLocal('x18n:explain'))).toMatchSnapshot()
  })

  it('builds the translate prompt', async () => {
    expect(wire(await ctx.rpc.invokeLocal('x18n:translate-prompt', { project, locale: 'de' }))).toMatchSnapshot()
  })

  it('lists versioned generated selections', async () => {
    expect(wire(await ctx.rpc.invokeLocal('x18n:extract-selections', { project }))).toMatchSnapshot()
  })

  it('lists extraction candidates', async () => {
    expect(wire(await ctx.rpc.invokeLocal('x18n:extract-candidates', { project }))).toMatchSnapshot()
  })

  it('rejects invalid input', async () => {
    // @ts-expect-error a client may send anything; the schema rejects it
    await expect(ctx.rpc.invokeLocal('x18n:key', { project })).rejects.toThrow()
  })

  it('plans, refuses placeholder problems, then applies and bumps the shared state', async () => {
    const state = await ctx.rpc.sharedState.get('x18n:state')
    const ops = [
      {
        type: 'set',
        key: 'app.greeting',
        locale: 'de',
        value: 'Hallo',
      },
    ] as const
    expect(wire(await ctx.rpc.invokeLocal('x18n:plan', {
      project,
      ops: [...ops],
    }))).toMatchSnapshot()
    expect((await ctx.rpc.invokeLocal('x18n:apply', {
      project,
      ops: [...ops],
    })).applied).toBe(false)
    const applied = await ctx.rpc.invokeLocal('x18n:apply', {
      project,
      ops: [
        {
          type: 'set',
          key: 'app.greeting',
          locale: 'de',
          value: 'Hallo {name}',
        },
      ],
    })
    expect(applied.applied).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'src/locales/de.json'), 'utf8')).app.greeting).toBe('Hallo {name}')
    await expect.poll(() => state.value().revision).toBeGreaterThan(0)
    expect(state.value().changedKeys).toContain('app.greeting')
  })
})

describe('agent tools', () => {
  it('names the tools for MCP', () => {
    expect(ctx.agent.list().tools.map(t => ({
      id: t.id,
      safety: t.safety,
      description: t.description,
      inputSchema: t.inputSchema,
    }))).toMatchSnapshot()
  })

  it('reports status, keys, check and the translate prompt', async () => {
    expect(wire(await ctx.agent.invoke('x18n:status', {}))).toMatchSnapshot()
    expect(wire(await ctx.agent.invoke('x18n:keys', { missing: 'de', values: true, limit: 2 }))).toMatchSnapshot()
    expect(wire(await ctx.agent.invoke('x18n:search', { query: 'welcome' }))).toMatchSnapshot()
    expect(wire(await ctx.agent.invoke('x18n:check', {
      only: ['missing-translation'],
    }))).toMatchSnapshot()
    expect(wire(await ctx.agent.invoke('x18n:usages', { key: 'nav.home' }))).toMatchSnapshot()
    expect(wire(await ctx.agent.invoke('x18n:get', { key: 'nav.home' }))).toMatchSnapshot()
    await expect(ctx.agent.invoke('x18n:get', { key: 'nope' })).rejects.toThrow('Key not found')
  })

  it('rejects a page size that would not advance the cursor', async () => {
    for (const limit of [0, -1, 1.5]) {
      await expect(ctx.agent.invoke('x18n:keys', { limit })).rejects.toThrow(/Expected >=1|Invalid integer/)
      await expect(ctx.agent.invoke('x18n:translate_prompt', { locale: 'de', limit })).rejects.toThrow(/Expected >=1|Invalid integer/)
    }
  })

  it('returns placeholder problems instead of writing', async () => {
    const before = await readFile(join(root, 'src/locales/de.json'), 'utf8')
    expect(wire(await ctx.agent.invoke('x18n:set_messages', {
      messages: {
        de: { 'app.greeting': 'Hallo' },
      },
    }))).toMatchSnapshot()
    expect(await readFile(join(root, 'src/locales/de.json'), 'utf8')).toBe(before)
    const written = await ctx.agent.invoke('x18n:set_messages', {
      messages: {
        de: { 'nav.about': 'Über uns' },
      },
    })
    expect(written).toMatchObject({
      applied: true,
      keys: ['nav.about'],
    })
    expect(JSON.parse(await readFile(join(root, 'src/locales/de.json'), 'utf8')).nav.about).toBe('Über uns')
  })

  it('plans a rename and applies it on confirm', async () => {
    expect(wire(await ctx.agent.invoke('x18n:rename_key', { from: 'unused', to: 'gone' }))).toMatchSnapshot()
    expect(JSON.parse(await readFile(join(root, 'src/locales/en.json'), 'utf8')).unused).toBe('Nobody uses me')
    expect(await ctx.agent.invoke('x18n:rename_key', { from: 'unused', to: 'gone', confirm: true })).toMatchObject({ applied: true })
    expect(JSON.parse(await readFile(join(root, 'src/locales/en.json'), 'utf8')).gone).toBe('Nobody uses me')
  })

  it('deletes on confirm only', async () => {
    expect(await ctx.agent.invoke('x18n:delete_key', { key: 'gone' })).toMatchObject({ applied: false })
    expect(await ctx.agent.invoke('x18n:delete_key', { key: 'gone', confirm: true })).toMatchObject({ applied: true })
    expect(JSON.parse(await readFile(join(root, 'src/locales/en.json'), 'utf8')).gone).toBeUndefined()
  })

  it('plans an extraction', async () => {
    expect(wire(await ctx.agent.invoke('x18n:extract_plan', {}))).toMatchSnapshot()
  })

  it('plans the bulk delete of unused keys, and deletes them on confirm', async () => {
    const plan = wire(await ctx.agent.invoke('x18n:delete_unused_keys', {}))
    expect(plan).toMatchSnapshot()
    expect(plan).toMatchObject({
      applied: false,
      keys: ['linked'],
      kept: [],
    })
    expect(JSON.parse(await readFile(join(root, 'src/locales/en.json'), 'utf8')).linked).toBeDefined()
    const done = await ctx.rpc.invokeLocal('x18n:delete-unused', { project, confirm: true })
    expect(done).toMatchObject({
      applied: true,
      deleted: [
        { key: 'linked' },
      ],
    })
    expect(JSON.parse(await readFile(join(root, 'src/locales/en.json'), 'utf8')).linked).toBeUndefined()
    expect(await ctx.agent.invoke('x18n:delete_unused_keys', {})).toMatchObject({ keys: [], deleted: [] })
  })
})

describe('reviews', () => {
  it('adds reviews through apply and the agent tool, and lists them on the key, the grid and the summary', async () => {
    const applied = await ctx.rpc.invokeLocal('x18n:apply', {
      project,
      ops: [
        {
          type: 'review',
          key: 'app.title',
          locale: 'de',
          review: 'suggestion',
          suggestion: 'Meine Anwendung',
        },
      ],
    })
    expect(applied).toMatchObject({
      applied: true,
      changes: [
        { type: 'create', path: '.x18n/reviews.yml' },
      ],
    })
    expect(await ctx.agent.invoke('x18n:review', {
      key: 'app.title',
      locale: 'de',
      review: 'request-change',
      text: 'Too literal',
    })).toMatchObject({ applied: true })

    const threads = await ctx.rpc.invokeLocal('x18n:reviews', { project, open: true })
    expect(threads).toMatchObject([
      {
        key: 'app.title',
        locale: 'de',
        state: 'changes-requested',
        comments: [
          { type: 'suggestion', suggestion: 'Meine Anwendung' },
          { type: 'request-change', text: 'Too literal' },
        ],
      },
    ])
    expect((await ctx.rpc.invokeLocal('x18n:key', { project, key: 'app.title' }))?.reviews).toEqual(threads)
    expect((await ctx.rpc.invokeLocal('x18n:keys', { project })).rows.find(r => r.key === 'app.title')?.reviews).toEqual({ de: 'changes-requested' })
    expect((await ctx.rpc.invokeLocal('x18n:project')).projects[0]?.reviews).toBe(1)
    expect(await ctx.agent.invoke('x18n:reviews', { open: true })).toEqual({ threads })

    await ctx.rpc.invokeLocal('x18n:apply', {
      project,
      ops: [
        { type: 'apply-suggestion', id: threads[0]!.comments[0]!.id },
        { type: 'resolve-review', id: threads[0]!.comments[1]!.id },
      ],
    })
    expect(JSON.parse(await readFile(join(root, 'src/locales/de.json'), 'utf8')).app.title).toBe('Meine Anwendung')
    expect(await ctx.rpc.invokeLocal('x18n:reviews', { project, open: true })).toEqual([])
  })
})

describe('generated extraction RPC', () => {
  it('round-trips versioned selections, rejects stale context, and leaves raw apply available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'x18n-selections-'))
    await mkdir(join(dir, 'src'))
    await mkdir(join(dir, 'locales'))
    await writeFile(join(dir, 'locales/en.json'), '{}')
    await writeFile(join(dir, 'src/App.vue'), '<template><h1>Welcome aboard</h1><p>Another heading</p></template>')
    await writeFile(join(dir, 'x18n.config.json'), JSON.stringify({
      presets: ['vue-i18n'],
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    }))
    const ws = await loadWorkspace({ cwd: dir, cache: false })
    const context = await createHostContext({
      cwd: dir,
      mode: 'dev',
      host: {
        mountStatic: () => {},
        resolveOrigin: () => 'http://localhost',
        getStorageDir: () => join(dir, '.devframe'),
      },
    })
    try {
      await createX18nDevframe(ws.projects).setup(context)
      const candidates = await context.rpc.invokeLocal('x18n:extract-selections', {})
      expect(wire(candidates)).toMatchSnapshot()
      expect(candidates).toHaveLength(2)
      expect(candidates[0]!.context).toMatch(/^\[1,/)
      const { path, range, original, context: token } = candidates[0]!
      const item = {
        path,
        range,
        original,
        context: token,
        key: 'page.$&',
      }
      await expect(context.rpc.invokeLocal('x18n:extract-selected', {
        items: [
          { ...item, context: 'stale' },
        ],
      })).rejects.toThrow()
      expect(await readFile(join(dir, 'locales/en.json'), 'utf8')).toBe('{}')
      const result = await context.rpc.invokeLocal('x18n:extract-selected', {
        items: [item],
      })
      expect(result.applied).toBe(true)
      expect(await readFile(join(dir, 'src/App.vue'), 'utf8')).toContain('$t(\'page.$&\')')
      await expect(context.rpc.invokeLocal('x18n:extract-selected', {
        items: [item],
      })).rejects.toThrow()
      const remaining = await context.rpc.invokeLocal('x18n:extract-candidates', {})
      expect(remaining).toHaveLength(1)
      await context.rpc.invokeLocal('x18n:extract-apply', {
        items: [
          { ...remaining[0]!, key: 'manual', replacement: '{{ custom() }}' },
        ],
      })
      expect(await readFile(join(dir, 'src/App.vue'), 'utf8')).toContain('{{ custom() }}')
    }
    finally {
      ws.projects.forEach(p => p.project.dispose())
      await rm(dir, { recursive: true, force: true })
    }
  })
})
