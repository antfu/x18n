import type { EditOp, Format, HistoryProvider, KeyString, LocaleCode, MessageChange, Plugin, Project, ReviewEdit, UserConfig } from '@x18n/core'
import { renderPrompt } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { createTestProject, json } from './_utils'

const locales = {
  'locales/en.json': json({
    login: { title: 'Log in' },
    save: 'Save',
  }),
  'locales/de.json': json({
    login: { title: 'Einloggen' },
    save: 'Speichern',
  }),
}

const ada = { name: 'Ada', email: 'ada@example.com' }
const time = '2026-10-15T09:12:00.000Z'

async function setup(files: Record<string, string> = {}, config: UserConfig = {}): Promise<{ project: Project, files: Map<string, string> }> {
  return createTestProject({
    ...locales,
    ...files,
  }, {
    resources: [
      { pattern: 'locales/{locale}.json' },
    ],
    ...config,
  })
}

async function run(project: Project, ...ops: EditOp[]): Promise<void> {
  await project.apply(project.plan(ops))
}

function review(key: KeyString, locale: LocaleCode, type: Extract<EditOp, { type: 'review' }>['review'], extra: { text?: string, suggestion?: string, id: string }): EditOp {
  return {
    type: 'review',
    key,
    locale,
    review: type,
    author: ada,
    time,
    ...extra,
  }
}

describe('reviews', () => {
  it('writes comments to .x18n/reviews.yml, sorted by key', async () => {
    const { project, files } = await setup()
    await run(project, review('save', 'de', 'comment', { text: 'Fine?', id: 'aaaaaa' }), review('login.title', 'de', 'request-change', { text: 'Too formal, use "Anmelden".', id: 'bbbbbb' }))
    expect(files.get('.x18n/reviews.yml')).toMatchInlineSnapshot(`
      "# yaml-language-server: $schema=https://x18n.dev/schema/reviews.json
      x18n: 1
      threads:
        login.title:
          de:
            - id: bbbbbb
              type: request-change
              author:
                name: Ada
                email: ada@example.com
              time: 2026-10-15T09:12:00.000Z
              text: Too formal, use "Anmelden".
        save:
          de:
            - id: aaaaaa
              type: comment
              author:
                name: Ada
                email: ada@example.com
              time: 2026-10-15T09:12:00.000Z
              text: Fine?
      "
    `)
    expect(project.reviews().map(t => [t.key, t.locale, t.state])).toEqual([
      ['login.title', 'de', 'changes-requested'],
      ['save', 'de', 'commented'],
    ])
    expect(project.get('save')?.reviews[0]?.comments[0]).toMatchObject({ id: 'aaaaaa', text: 'Fine?', stale: false })
  })

  it('fills in ids and times, and keeps them when planning again', async () => {
    const { project } = await setup()
    const plan = project.plan([
      {
        type: 'review',
        key: 'save',
        locale: 'de',
        review: 'comment',
        text: 'Hm',
      },
    ])
    const op = plan.ops[0]
    expect(op?.type === 'review' && op.id).toMatch(/^[a-z0-9]{6}$/)
    expect(op?.type === 'review' && op.time).toMatch(/^\d{4}-\d\d-\d\dT/)
    await project.apply(plan)
    expect(project.reviews()[0]?.comments[0]?.id).toBe(op?.type === 'review' && op.id)
  })

  it('marks an approval stale once the value changes', async () => {
    const { project } = await setup()
    await run(project, review('save', 'de', 'approve', { id: 'aaaaaa' }))
    expect(project.reviews()[0]).toMatchObject({
      state: 'approved',
      comments: [
        { value: 'Speichern', stale: false },
      ],
    })
    await run(project, {
      type: 'set',
      key: 'save',
      locale: 'de',
      value: 'Sichern',
    })
    expect(project.reviews()[0]).toMatchObject({
      state: 'stale-approval',
      comments: [
        { stale: true },
      ],
    })
  })

  it('applies a suggestion: sets the value and resolves it in one plan', async () => {
    const { project, files } = await setup()
    await run(project, review('login.title', 'de', 'suggestion', { suggestion: 'Anmelden', id: 'aaaaaa' }))
    expect(project.reviews()[0]?.state).toBe('suggested')
    const plan = project.plan([
      { type: 'apply-suggestion', id: 'aaaaaa' },
    ])
    expect(plan.changes.map(c => c.path)).toEqual(['locales/de.json', '.x18n/reviews.yml'])
    await project.apply(plan)
    expect(JSON.parse(files.get('locales/de.json')!).login.title).toBe('Anmelden')
    expect(project.reviews()[0]?.comments[0]?.resolved).toBe(true)
    expect(project.reviews({ open: true })).toEqual([])
    expect(() => project.plan([
      { type: 'apply-suggestion', id: 'aaaaaa' },
    ])).toThrow(expect.objectContaining({ code: 'X18N5005' }))
    expect(() => project.plan([
      { type: 'resolve-review', id: 'nope' },
    ])).toThrow(expect.objectContaining({ code: 'X18N5004' }))
  })

  it('moves threads with a rename and drops them with a delete', async () => {
    const { project } = await setup()
    await run(project, review('login.title', 'de', 'comment', { text: 'a', id: 'aaaaaa' }), review('save', 'de', 'comment', { text: 'b', id: 'bbbbbb' }))
    await run(project, { type: 'rename-prefix', from: 'login', to: 'auth' })
    expect(project.reviews().map(t => t.key)).toEqual(['auth.title', 'save'])
    await run(project, { type: 'delete', key: 'save' })
    expect(project.reviews().map(t => t.key)).toEqual(['auth.title'])
  })

  it('reports open change requests, with a fix that resolves them', async () => {
    const { project } = await setup()
    await run(project, review('save', 'de', 'request-change', { text: 'Use "Sichern".', id: 'aaaaaa' }))
    const diagnostic = project.analyze().diagnostics.find(d => d.code === 'review-changes-requested')!
    expect(diagnostic).toMatchObject({
      severity: 'info',
      key: 'save',
      locale: 'de',
      message: 'Change requested by Ada for "save" in de: Use "Sichern".',
      location: { path: 'locales/de.json' },
    })
    await project.apply(project.plan(diagnostic.fixes[0]!.ops))
    expect(project.analyze().diagnostics.some(d => d.code === 'review-changes-requested')).toBe(false)
  })

  it('rejects comments on unknown keys and suggestions without a value', async () => {
    const { project } = await setup()
    expect(() => project.plan([
      {
        type: 'review',
        key: 'nope',
        locale: 'de',
        review: 'comment',
      },
    ])).toThrow(expect.objectContaining({ code: 'X18N4006' }))
    expect(() => project.plan([
      {
        type: 'review',
        key: 'save',
        locale: 'de',
        review: 'suggestion',
      },
    ])).toThrow(expect.objectContaining({ code: 'X18N4008' }))
  })

  it('reports an unreadable review file and refuses to overwrite it', async () => {
    const { project } = await setup({ '.x18n/reviews.yml': 'x18n: 2\n' })
    expect(project.analyze().diagnostics.find(d => d.location?.path === '.x18n/reviews.yml')?.message).toContain('X18N5001')
    expect(() => project.plan([
      {
        type: 'review',
        key: 'save',
        locale: 'de',
        review: 'comment',
      },
    ])).toThrow(expect.objectContaining({ code: 'X18N5003' }))
    // Renames still work, without touching the file.
    expect(project.plan([
      { type: 'rename', from: 'save', to: 'store' },
    ]).changes.map(c => c.path).sort()).toEqual(['locales/de.json', 'locales/en.json'])
  })

  it('asks review prompts to leave suggestions for a human', async () => {
    const { project } = await setup()
    expect(renderPrompt(project.prompt('review', 'de'))).toContain('`x18n review suggest <key> --locale de --value <text> --text <why>`')
  })

  it('is off with `review.enabled: false`', async () => {
    const { project } = await setup({}, {
      review: { enabled: false },
    })
    expect(project.reviewFile).toBeUndefined()
    expect(renderPrompt(project.prompt('review', 'de'))).toContain('`x18n set <key> --locale de --value <text>`')
    expect(() => project.plan([
      {
        type: 'review',
        key: 'save',
        locale: 'de',
        review: 'comment',
      },
    ])).toThrow('`review.enabled` is false')
  })

  it('reloads when the review file changes on disk', async () => {
    const { project, files } = await setup()
    files.set('.x18n/reviews.yml', 'x18n: 1\nthreads:\n  save:\n    de:\n      - { id: abcdef, type: comment, time: "2026-01-01T00:00:00Z", text: hi }\n')
    const change = await project.update([
      { type: 'create', path: '.x18n/reviews.yml' },
    ])
    expect(change?.keys).toEqual(['save'])
    expect(project.reviews()[0]?.comments[0]?.text).toBe('hi')
  })
})

describe('source records', () => {
  const day = 86_400_000
  // Git says the German title is older than the English one.
  const git: HistoryProvider = {
    id: 'fake',
    async load() {
      const at = (d: number): MessageChange => ({ updatedAt: d * day })
      return {
        changes: new Map<KeyString, Map<LocaleCode, MessageChange>>([
          [
            'login.title',
            new Map([
              [
                'en',
                at(5),
              ],
              [
                'de',
                at(2),
              ],
            ]),
          ],
          [
            'save',
            new Map([
              [
                'en',
                at(5),
              ],
              [
                'de',
                at(2),
              ],
            ]),
          ],
        ]),
      }
    },
  }
  const plugins = [
    {
      name: 'fake-history',
      histories: [git],
    },
  ]
  const stale = (project: Project): readonly KeyString[] => project.analyze().coverage.find(c => c.locale === 'de')!.outdated

  it('`mark-fresh` makes a translation fresh until its source changes', async () => {
    const { project } = await setup({}, { plugins })
    await project.loadHistory()
    expect(stale(project)).toEqual(['login.title', 'save'])
    await run(project, { type: 'mark-fresh', key: 'save' })
    expect(stale(project)).toEqual(['login.title'])
    await run(project, {
      type: 'set',
      key: 'save',
      locale: 'en',
      value: 'Store',
    })
    expect(stale(project)).toEqual(['login.title', 'save'])
  })

  it('records the source of a translation written by x18n, once the project has a review file', async () => {
    const { project, files } = await setup({}, { plugins })
    await project.loadHistory()
    expect(project.plan([
      {
        type: 'set',
        key: 'save',
        locale: 'de',
        value: 'Sichern',
      },
    ]).changes.map(c => c.path)).toEqual(['locales/de.json'])
    files.set('.x18n/reviews.yml', 'x18n: 1\n')
    await project.update([
      { type: 'create', path: '.x18n/reviews.yml' },
    ])
    // A source and a target set together: the target is recorded against the new source.
    await run(project, {
      type: 'set',
      key: 'login.title',
      locale: 'en',
      value: 'Sign in',
    }, {
      type: 'set',
      key: 'login.title',
      locale: 'de',
      value: 'Anmelden',
    })
    expect(files.get('.x18n/reviews.yml')).toContain('sources:\n  login.title:\n    de: ')
    expect(stale(project)).toEqual(['save'])
  })
})

describe('reviewEdit hook', () => {
  const recordFormat: Format = {
    id: 'record',
    extensions: ['rec'],
    parse: (text, ctx) => ({
      tree: { [ctx.path.slice(ctx.path.lastIndexOf('/') + 1, -'.rec'.length)]: JSON.parse(text).text },
    }),
    edit: (text, ops) => {
      const record = JSON.parse(text)
      for (const op of ops) {
        if (op.type === 'set')
          record.text = op.value
      }
      return [
        {
          range: { start: 0, end: text.length },
          text: json(record),
        },
      ]
    },
  }

  function verifier(seen: ReviewEdit['type'][]): Plugin {
    return {
      name: 'verifier',
      formats: [recordFormat],
      reviewEdit(edit, ctx) {
        seen.push(edit.type)
        if (edit.type !== 'approve')
          return undefined
        const message = ctx.message(edit.key, edit.locale)
        const path = message && ctx.resource(message.resource)?.path
        const text = path && ctx.text(path)
        if (!text)
          return undefined
        const record = JSON.parse(text)
        if (record.text !== edit.comment.value)
          return undefined
        return [
          {
            path,
            content: json({
              ...record,
              review: 'verified',
              verifiedBy: edit.comment.author?.name,
              updatedAt: edit.comment.time,
            }),
          },
        ]
      },
    }
  }

  async function records(seen: ReviewEdit['type'][]): Promise<{ project: Project, files: Map<string, string> }> {
    return createTestProject({
      'records/en/save.rec': json({ text: 'Save' }),
      'records/de/save.rec': json({ text: 'Speichern', review: 'draft' }),
    }, {
      locales: ['en', 'de'],
      resources: [
        { pattern: 'records/{locale}/*.rec', format: 'record' },
      ],
      keyStyle: 'flat',
      write: { sort: false },
      plugins: [
        verifier(seen),
      ],
    })
  }

  it('lets a plugin write a resource in the plan of an approval', async () => {
    const seen: ReviewEdit['type'][] = []
    const { project, files } = await records(seen)
    const plan = project.plan([
      review('save', 'de', 'approve', { id: 'aaaaaa' }),
    ])
    expect(plan.changes.map(c => c.path)).toEqual(['records/de/save.rec', '.x18n/reviews.yml'])
    expect(files.get('records/de/save.rec')).toContain('"draft"')
    await project.apply(plan)
    expect(seen).toEqual(['approve'])
    expect(JSON.parse(files.get('records/de/save.rec')!)).toEqual({
      text: 'Speichern',
      review: 'verified',
      verifiedBy: 'Ada',
      updatedAt: time,
    })
    expect(project.message('save', 'de')?.value).toBe('Speichern')
  })

  it('passes change requests, suggestions and resolutions to the hook without a write', async () => {
    const seen: ReviewEdit['type'][] = []
    const { project, files } = await records(seen)
    await run(project, review('save', 'de', 'request-change', { text: 'Use "Sichern".', id: 'aaaaaa' }), review('save', 'de', 'suggestion', { suggestion: 'Sichern', id: 'bbbbbb' }), review('save', 'de', 'comment', { text: 'Agreed.', id: 'cccccc' }))
    await run(project, { type: 'resolve-review', id: 'aaaaaa' }, { type: 'apply-suggestion', id: 'bbbbbb' })
    expect(seen).toEqual([
      'request-change',
      'suggestion',
      'comment',
      'resolve-review',
      'apply-suggestion',
    ])
    expect(JSON.parse(files.get('records/de/save.rec')!)).toEqual({ text: 'Sichern', review: 'draft' })
  })
})
