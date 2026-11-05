import type { Plugin, TranslateBatchResult, TranslatedItem, TranslationUsage, Translator } from '@x18n/core'
import type { LanguageModel } from 'ai'
import { defineTranslator } from '@x18n/core'
import { generateText, jsonSchema, NoObjectGeneratedError, Output } from 'ai'

export interface AiTranslatorOptions {
  /**
   * A model from any AI SDK provider (`anthropic('claude-sonnet-5-5')`), or a model id for the AI SDK default
   * provider, the Vercel AI Gateway (`'anthropic/claude-sonnet-5-5'`, with `AI_GATEWAY_API_KEY` set).
   */
  readonly model: LanguageModel
  /** Translator id, for config `translate.translators`. Default `ai`; set it to use two models. */
  readonly id?: string | undefined
  /** Messages per request. Default 40. */
  readonly maxItems?: number | undefined
  /** Requests in flight at once. Default 4. */
  readonly concurrency?: number | undefined
  readonly temperature?: number | undefined
  /** Retries of a failed request, by the AI SDK. Default 2. */
  readonly maxRetries?: number | undefined
  /** USD per million tokens, when the provider reports no cost. */
  readonly pricing?: { readonly input: number, readonly output: number } | undefined
}

interface Reply {
  readonly translations: readonly { readonly id: string, readonly text: string }[]
}

function isReply(value: unknown): value is Reply {
  const translations = (value as { translations?: unknown } | null)?.translations
  return Array.isArray(translations) && translations.every(t => typeof t === 'object' && t !== null && typeof (t as { id?: unknown }).id === 'string' && typeof (t as { text?: unknown }).text === 'string')
}

const replySchema = jsonSchema<Reply>({
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
}, {
  validate: value => isReply(value)
    ? { success: true, value }
    : {
        success: false,
        error: new Error('expected { translations: [{ id, text }] }'),
      },
})

function modelName(model: LanguageModel): string {
  return typeof model === 'string'
    ? model
    : `${model.provider}/${model.modelId}`
}

/** The cost the provider reports (the AI Gateway reports one per request). */
function reportedCost(metadata: unknown): number | undefined {
  const cost = (metadata as { gateway?: { cost?: unknown } } | undefined)?.gateway?.cost
  const n = typeof cost === 'string'
    ? Number(cost)
    : cost
  return typeof n === 'number' && Number.isFinite(n)
    ? n
    : undefined
}

function usageOf(options: AiTranslatorOptions, usage: { inputTokens?: number | undefined, outputTokens?: number | undefined } | undefined, metadata?: unknown): TranslationUsage {
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const cost = reportedCost(metadata) ?? (options.pricing
    ? (inputTokens * options.pricing.input + outputTokens * options.pricing.output) / 1e6
    : undefined)
  return {
    requests: 1,
    inputTokens,
    outputTokens,
    ...cost !== undefined && { costUsd: cost },
  }
}

/** A translator that sends x18n's translate prompt to any AI SDK language model, with structured output. */
export function aiTranslator(options: AiTranslatorOptions): Translator {
  const name = modelName(options.model)
  return defineTranslator({
    id: options.id ?? 'ai',
    features: {
      placeholders: 'raw',
      context: true,
      feedback: true,
      update: true,
      glossary: 'prompt',
      batch: { maxItems: options.maxItems ?? 40 },
      concurrency: options.concurrency ?? 4,
      paid: true,
    },
    fingerprint: JSON.stringify([name, options.temperature ?? null]),
    async translate(batch): Promise<TranslateBatchResult> {
      try {
        const result = await generateText({
          model: options.model,
          instructions: batch.prompt.system,
          prompt: batch.prompt.user,
          output: Output.object({ schema: replySchema }),
          maxRetries: options.maxRetries ?? 2,
          abortSignal: batch.signal,
          ...options.temperature !== undefined && { temperature: options.temperature },
        })
        const items: TranslatedItem[] = result.output.translations.map(t => ({ id: t.id, text: t.text }))
        return {
          items,
          usage: usageOf(options, result.usage, result.providerMetadata),
          model: result.response.modelId || name,
        }
      }
      catch (error) {
        // A reply that does not match the schema fails every item; core retries them with the problem listed.
        if (NoObjectGeneratedError.isInstance(error)) {
          return {
            items: [],
            usage: usageOf(options, error.usage),
            model: name,
          }
        }
        throw error
      }
    },
  })
}

/** The plugin: `plugins: [translatorAi({ model })]`, or `['@x18n/translator-ai', { model: 'anthropic/claude-sonnet-5-5' }]` in YAML. */
export default function translatorAi(options: AiTranslatorOptions): Plugin {
  return {
    name: 'x18n:translator-ai',
    translators: [
      aiTranslator(options),
    ],
  }
}

export { translatorAi }
