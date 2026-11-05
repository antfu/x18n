import type { Plugin, Project, TranslateBatch, TranslateBatchResult, TranslationEvent, Translator, TranslatorFeatures, UserConfig } from '@x18n/core'
import { createMemoryHost, createProject, maskPlaceholders, resolveConfig, wordDiff } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { createBuiltins } from '../src'
import { braces } from '../src/placeholders'
import { json } from './_utils'

const features: TranslatorFeatures = {
  placeholders: 'raw',
  context: true,
  feedback: true,
  update: true,
  glossary: 'prompt',
  batch: { maxItems: 50 },
  paid: true,
}

/** A translator that answers from a function and records every batch it gets. */
function fake(id: string, answer: (text: string, batch: TranslateBatch, call: number) => string | undefined, overrides: Partial<Translator> = {}): Translator & { readonly batches: TranslateBatch[] } {
  const batches: TranslateBatch[] = []
  return {
    id,
    features,
    batches,
    async translate(batch): Promise<TranslateBatchResult> {
      batches.push(batch)
      const call = batches.length
      return {
        items: batch.items.flatMap((item) => {
          const text = answer(item.text, batch, call)
          return text === undefined
            ? []
            : [
                { id: item.id, text },
              ]
        }),
        usage: { requests: 1, costUsd: 0.01 },
        model: `${id}-model`,
      }
    },
    ...overrides,
  }
}

/** Uppercases the text, keeping `{placeholders}` as they are. */
function upper(text: string): string {
  return text.split(/(\{\w+\})/).map((part, i) => i % 2 === 1
    ? part
    : part.toUpperCase()).join('')
}

const files = {
  'locales/en.json': json({
    greeting: 'Hello {name}',
    save: 'Save',
    cancel: 'Cancel',
    again: 'Save',
    done: 'Done',
  }),
  'locales/de.json': json({
    done: 'Fertig',
  }),
}

async function setup(translators: readonly Translator[], config: UserConfig = {}, extra: Record<string, string> = {}): Promise<{ project: Project, files: Map<string, string>, cache: Map<string, string> }> {
  const host = createMemoryHost({
    ...files,
    ...extra,
  })
  const cache = new Map<string, string>()
  const withCache = {
    ...host,
    cache: {
      get: async (key: string) => cache.get(key),
      set: async (key: string, value: string) => {
        cache.set(key, value)
      },
    },
    env: (name: string) => name === 'TEST_KEY'
      ? 'secret'
      : undefined,
  }
  const plugin: Plugin = {
    name: 'test-translators',
    translators,
    placeholders: [braces],
  }
  const setup = await resolveConfig({
    host: withCache,
    config: {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      plugins: [plugin],
      ...config,
    },
    builtins: await createBuiltins(),
  })
  const project = createProject({ host: withCache, setup })
  await project.ready
  return { project, files: host.files, cache }
}

async function translate(project: Project, options: Parameters<Project['planTranslation']>[0]) {
  const job = await project.planTranslation(options)
  const run = project.translate(job)
  const events: TranslationEvent[] = []
  for await (const event of run)
    events.push(event)
  return { job, events, result: await run.result }
}

describe('translation runs', () => {
  it('translates missing messages, writes them and records them as machine-translated', async () => {
    const translator = fake('fake', upper)
    const { project, files } = await setup([translator])
    const { job, result } = await translate(project, {
      to: ['de'],
    })
    expect(job.items.map(i => i.key)).toEqual(['again', 'cancel', 'greeting', 'save'])
    expect(job.estimate).toEqual([
      {
        translator: 'fake',
        items: 4,
        characters: 26,
        batches: 1,
        paid: true,
      },
    ])
    expect(result.candidates.map(c => [c.key, c.value, c.write])).toEqual([
      ['again', 'SAVE', 'value'],
      ['cancel', 'CANCEL', 'value'],
      ['greeting', 'HELLO {name}', 'value'],
      ['save', 'SAVE', 'value'],
    ])
    // `again` and `save` share a source, so one item is sent for both.
    expect(translator.batches[0]!.items.map(i => i.text)).toEqual(['Save', 'Cancel', 'Hello {name}'])
    expect(translator.batches[0]!.items[2]!.placeholders).toEqual([
      { token: '{name}', raw: '{name}', syntax: 'braces' },
    ])
    await project.apply(result.plan)
    expect(JSON.parse(files.get('locales/de.json')!)).toEqual({
      done: 'Fertig',
      greeting: 'HELLO {name}',
      save: 'SAVE',
      cancel: 'CANCEL',
      again: 'SAVE',
    })
    expect(project.machine('save', 'de')).toMatchObject({ translator: 'fake', model: 'fake-model', prompt: '1' })
    expect(files.get('.x18n/reviews.yml')).toContain('machine:')
    expect(project.machine('done', 'de')).toBeUndefined()
  })

  it('a human edit clears the machine mark', async () => {
    const { project } = await setup([
      fake('fake', upper),
    ])
    await project.apply((await translate(project, {
      to: ['de'],
    })).result.plan)
    await project.apply(project.plan([
      {
        type: 'set',
        key: 'save',
        locale: 'de',
        value: 'Speichern',
      },
    ]))
    expect(project.machine('save', 'de')).toBeUndefined()
    expect(project.machine('cancel', 'de')).toBeDefined()
  })

  it('leaves review suggestions for values that exist, unless overwrite', async () => {
    const { project } = await setup([
      fake('fake', upper),
    ])
    const suggestion = await translate(project, {
      to: ['de'],
      keys: ['done'],
    })
    expect(suggestion.result.candidates.map(c => [c.key, c.value, c.write])).toEqual([
      ['done', 'DONE', 'suggestion'],
    ])
    expect(suggestion.result.plan.ops).toEqual([
      expect.objectContaining({
        type: 'review',
        review: 'suggestion',
        suggestion: 'DONE',
        author: { name: 'x18n translate (fake)' },
      }),
    ])
    const overwrite = await translate(project, {
      to: ['de'],
      keys: ['done'],
      overwrite: true,
    })
    expect(overwrite.result.candidates[0]!.write).toBe('value')
  })

  it('retries a failed item once with its problems, then falls through to the next translator', async () => {
    // Drops the placeholder every time.
    const bad = fake('bad', text => text.replace('{name}', 'NAME'))
    const good = fake('good', upper)
    const { project } = await setup([bad, good])
    const { result } = await translate(project, {
      to: ['de'],
      keys: ['greeting'],
    })
    expect(bad.batches).toHaveLength(2)
    expect(bad.batches[1]!.items[0]!.retry).toEqual({
      output: 'Hello NAME',
      problems: ['missing name'],
    })
    expect(good.batches).toHaveLength(1)
    expect(result.candidates.map(c => [c.value, c.translator])).toEqual([
      ['HELLO {name}', 'good'],
    ])
  })

  it('rejects items no translator gets right, and caches the rejection', async () => {
    const bad = fake('bad', () => '')
    const { project } = await setup([bad])
    const first = await translate(project, {
      to: ['de'],
      keys: ['save'],
    })
    expect(first.result.rejected).toEqual([
      {
        key: 'save',
        locale: 'de',
        translators: ['bad'],
        output: '',
        issues: [
          { code: 'empty', severity: 'error', message: 'The translation is empty.' },
        ],
      },
    ])
    expect(first.result.plan.ops).toEqual([])
    const second = await project.planTranslation({
      to: ['de'],
      keys: ['save'],
    })
    expect(second.skipped).toEqual([
      { key: 'save', locale: 'de', reason: 'cached-rejection' },
    ])
    expect((await project.planTranslation({
      to: ['de'],
      keys: ['save'],
      retryRejected: true,
    })).items).toHaveLength(1)
  })

  it('treats ids missing from the reply as failures, never as a guess by position', async () => {
    const lazy = fake('lazy', (text, _batch, call) => call === 1 && text === 'Save'
      ? undefined
      : upper(text))
    const { project } = await setup([lazy])
    const { result } = await translate(project, {
      to: ['de'],
      keys: ['save', 'cancel'],
    })
    expect(lazy.batches.map(b => b.items.map(i => i.text))).toEqual([
      ['Cancel', 'Save'],
      ['Save'],
    ])
    expect(result.candidates.map(c => c.value)).toEqual(['CANCEL', 'SAVE'])
  })

  it('answers repeated runs from the cache without calling the translator', async () => {
    const translator = fake('fake', upper)
    const { project } = await setup([translator])
    await translate(project, {
      to: ['de'],
      keys: ['save'],
    })
    const again = await translate(project, {
      to: ['de'],
      keys: ['save'],
    })
    expect(again.job.items).toEqual([
      {
        key: 'save',
        locale: 'de',
        translator: 'fake',
        kind: 'cached',
      },
    ])
    expect(again.result.candidates[0]).toMatchObject({ value: 'SAVE', cached: true })
    expect(translator.batches).toHaveLength(1)
  })

  it('masks placeholders for services with tag handling, and restores them', async () => {
    const xml = fake('xml', text => text.replace('Hello', 'Hallo'), {
      features: { ...features, placeholders: 'xml', context: false },
    })
    const { project } = await setup([xml])
    const { result } = await translate(project, {
      to: ['de'],
      keys: ['greeting'],
    })
    expect(xml.batches[0]!.items[0]).toMatchObject({
      text: 'Hello <x id="0"/>',
      placeholders: [
        { token: '<x id="0"/>', raw: '{name}' },
      ],
    })
    expect(xml.batches[0]!.rules).toEqual([])
    expect(result.candidates[0]!.value).toBe('Hallo {name}')
  })

  it('splits batches under the item limit and stops at the budget', async () => {
    const small = fake('small', upper, {
      features: {
        ...features,
        batch: { maxItems: 1 },
        concurrency: 1,
      },
    })
    const { project } = await setup([small])
    const { result } = await translate(project, {
      to: ['de'],
      budget: { usd: 0.02 },
    })
    expect(small.batches).toHaveLength(2)
    expect(result.candidates.map(c => c.key)).toEqual(['again', 'cancel', 'save']) // `again` shares the answer of `save`
    expect(result.skipped).toEqual([
      { key: 'greeting', locale: 'de', reason: 'budget' },
    ])
    expect(result.usage.small).toMatchObject({ requests: 2, costUsd: 0.02 })
  })

  it('stops at the item limit when planning', async () => {
    const { project } = await setup([
      fake('fake', upper),
    ])
    const job = await project.planTranslation({
      to: ['de'],
      limit: 2,
    })
    expect(job.items.map(i => i.key)).toEqual(['again', 'cancel'])
    expect(job.skipped.map(s => [s.key, s.reason])).toEqual([
      ['greeting', 'limit'],
      ['save', 'limit'],
    ])
  })

  it('skips pairs a translator does not serve, and sends only glossary terms the batch uses', async () => {
    const picky = fake('picky', upper, {
      supports: ({ to }) => to === 'de',
    })
    const { project } = await setup([picky], {
      glossary: [
        {
          term: 'Save',
          translations: { de: 'Speichern' },
        },
        { term: 'Nuxt', doNotTranslate: true },
      ],
    }, {
      'locales/fr.json': json({}),
    })
    const job = await project.planTranslation({
      to: 'all',
      keys: ['save'],
    })
    expect(job.items.map(i => i.locale)).toEqual(['de'])
    expect(job.skipped).toEqual([
      { key: 'save', locale: 'fr', reason: 'unsupported-pair' },
    ])
    const run = project.translate(job)
    await run.result
    expect(picky.batches[0]!.glossary).toEqual([
      {
        term: 'Save',
        translation: 'Speichern',
        note: undefined,
        doNotTranslate: false,
      },
    ])
    expect(picky.batches[0]!.prompt.system).toContain('- "Save": translate as "Speichern"')
  })

  it('renders word diffs for update mode', () => {
    expect(wordDiff('Save the file', 'Save all files')).toBe('Save [-the file-] {+all files+}')
  })

  it('runs message checks on candidates: warnings stay, errors reject', async () => {
    const copy = fake('copy', text => text)
    const info = await setup([copy])
    const kept = await translate(info.project, {
      to: ['de'],
      keys: ['cancel'],
    })
    expect(kept.result.candidates[0]!.issues).toEqual([
      { code: 'identical-to-source', severity: 'info', message: 'The translation is the same as the en source.' },
    ])
    const strict = await setup([
      fake('copy', text => text),
    ], {
      checks: { 'identical-to-source': 'error' },
    })
    const rejected = await translate(strict.project, {
      to: ['de'],
      keys: ['cancel'],
    })
    expect(rejected.result.rejected.map(r => r.issues[0]!.code)).toEqual(['identical-to-source'])
  })

  it('refuses unknown translators, and a project without any', async () => {
    const { project } = await setup([])
    await expect(project.planTranslation({
      to: ['de'],
    })).rejects.toThrow('No translator for de')
    await expect(project.planTranslation({
      to: ['de'],
      translators: ['nope'],
    })).rejects.toThrow('Unknown translator "nope"')
  })

  it('refuses a job from an older revision', async () => {
    const { project } = await setup([
      fake('fake', upper),
    ])
    const job = await project.planTranslation({
      to: ['de'],
    })
    await project.apply(project.plan([
      {
        type: 'set',
        key: 'save',
        locale: 'de',
        value: 'Speichern',
      },
    ]))
    expect(() => project.translate(job)).toThrow()
  })

  it('masks the same placeholder text with one token', () => {
    const found = [
      {
        syntax: 'braces',
        text: '{a}',
        name: 'a',
        range: { start: 0, end: 3 },
      },
      {
        syntax: 'braces',
        text: '{a}',
        name: 'a',
        range: { start: 4, end: 7 },
      },
    ]
    const masked = maskPlaceholders('{a} {a}', found, 'token')
    expect(masked.text).toBe('⟦0⟧ ⟦0⟧')
    expect(masked.restore('⟦0⟧-⟦0⟧')).toBe('{a}-{a}')
  })
})

describe('batch approval', () => {
  async function translated(): Promise<Project> {
    const { project } = await setup([
      fake('fake', upper),
    ])
    await project.apply((await translate(project, {
      to: ['de'],
    })).result.plan)
    return project
  }

  it('approves machine-translated messages, which clears the mark', async () => {
    const project = await translated()
    const approval = project.planApprovals({ machine: true })
    expect(approval.approved.map(a => [a.key, a.value, a.machine])).toEqual([
      ['again', 'SAVE', 'fake'],
      ['cancel', 'CANCEL', 'fake'],
      ['greeting', 'HELLO {name}', 'fake'],
      ['save', 'SAVE', 'fake'],
    ])
    await project.apply(approval.plan)
    expect(project.machine('save', 'de')).toBeUndefined()
    expect(project.planApprovals({ glob: '**' }).skipped.map(s => [s.key, s.reason])).toEqual([
      ['again', 'already-approved'],
      ['cancel', 'already-approved'],
      ['greeting', 'already-approved'],
      ['save', 'already-approved'],
    ])
  })

  it('needs a filter, and skips values that changed since the reviewer saw them', async () => {
    const project = await translated()
    expect(() => project.planApprovals({})).toThrow('needs a key glob')
    const approval = project.planApprovals({
      values: [
        { key: 'save', locale: 'de', value: 'SAVE' },
        { key: 'cancel', locale: 'de', value: 'Abbrechen' },
      ],
    })
    expect(approval.approved.map(a => a.key)).toEqual(['save'])
    expect(approval.skipped).toEqual([
      { key: 'cancel', locale: 'de', reason: 'value-changed' },
    ])
  })

  it('skips open change requests, values that fail checks, and messages past the limit', async () => {
    const project = await translated()
    await project.apply(project.plan([
      {
        type: 'set',
        key: 'greeting',
        locale: 'de',
        value: 'Hallo',
      },
      {
        type: 'review',
        key: 'cancel',
        locale: 'de',
        review: 'request-change',
        text: 'Use "Abbrechen".',
      },
    ]))
    const approval = project.planApprovals({ glob: '**', limit: 1 })
    expect(approval.approved.map(a => a.key)).toEqual(['again'])
    expect(approval.skipped.map(s => [s.key, s.reason])).toEqual([
      ['cancel', 'changes-requested'],
      ['done', 'limit'],
      ['greeting', 'failing-check'],
      ['save', 'limit'],
    ])
    expect(project.planApprovals({ glob: 'cancel', overrideChangeRequests: true }).approved.map(a => a.key)).toEqual(['cancel'])
  })
})
