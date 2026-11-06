import { createBuiltins } from '@x18n/builtins'
import { createMemoryHost, createProject, resolveConfig } from '@x18n/core'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import translatorAi from '../src'

type CallOptions = Parameters<MockLanguageModelV4['doGenerate']>[0]

const usage = {
  inputTokens: {
    total: 1000,
    noCache: 1000,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 200, text: 200, reasoning: undefined },
}

/** A model that answers with `reply(ids)` and records the prompts it gets. */
function mock(reply: (items: { id: string, text: string }[]) => string) {
  const calls: CallOptions[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options)
      const user = options.prompt.find(m => m.role === 'user')!
      const text = (user.content as { type: string, text: string }[]).map(p => p.text).join('')
      const items = JSON.parse(text.slice(text.indexOf('\n') + 1)) as { id: string, text: string }[]
      return {
        content: [
          {
            type: 'text',
            text: reply(items),
          },
        ],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      }
    },
  })
  return { model, calls }
}

async function setup(model: MockLanguageModelV4) {
  const host = createMemoryHost({
    'locales/en.json': JSON.stringify({ hello: 'Hello {name}', save: 'Save' }),
    'locales/de.json': JSON.stringify({}),
  })
  const setup = await resolveConfig({
    host,
    config: {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      plugins: [
        translatorAi({
          model,
          pricing: { input: 3, output: 15 },
        }),
      ],
      translate: { subject: 'the UI of a test app' },
    },
    builtins: await createBuiltins(),
  })
  const project = createProject({ host, setup })
  await project.ready
  return project
}

describe('@x18n/translator-ai', () => {
  it('sends the translate prompt with structured output and maps the reply by id', async () => {
    const { model, calls } = mock(items => JSON.stringify({
      translations: items.map(item => ({
        id: item.id,
        text: item.text === 'Save'
          ? 'Speichern'
          : 'Hallo {name}',
      })).reverse(),
    }))
    const project = await setup(model)
    const run = project.translate(await project.planTranslation({
      to: ['de'],
    }))
    const result = await run.result
    expect(result.candidates.map(c => [c.key, c.value, c.translator])).toEqual([
      ['hello', 'Hallo {name}', 'ai'],
      ['save', 'Speichern', 'ai'],
    ])
    expect(result.usage.ai).toEqual({
      requests: 1,
      characters: 16,
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.006,
    })
    expect(calls).toHaveLength(1)
    const system = calls[0]!.prompt.find(m => m.role === 'system')!.content as string
    expect(system).toContain('You translate the UI of a test app from English (en) into German (de).')
    expect(calls[0]!.responseFormat).toMatchObject({ type: 'json' })
    expect(result.plan.ops[0]).toMatchObject({
      type: 'set',
      machine: { translator: 'ai', model: 'mock-model-id', prompt: '1' },
    })
  })

  it('retries items once when the reply does not match the schema', async () => {
    let call = 0
    const { model, calls } = mock(items => ++call === 1
      ? 'not json'
      : JSON.stringify({
          translations: items.map(item => ({
            id: item.id,
            text: item.text.replace('Save', 'Speichern').replace('Hello', 'Hallo'),
          })),
        }))
    const project = await setup(model)
    const result = await project.translate(await project.planTranslation({
      to: ['de'],
    })).result
    expect(calls).toHaveLength(2)
    expect(result.candidates.map(c => c.value)).toEqual(['Hallo {name}', 'Speichern'])
  })
})
