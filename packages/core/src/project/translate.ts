import type { PluginRegistry } from '../plugins'
import type { ResolvedConfig } from '../types/config'
import type { Host } from '../types/host'
import type { EditOp, KeyString, LocaleCode, Placeholder, Severity } from '../types/model'
import type { PlaceholderSyntax, Plugin } from '../types/plugin'
import type { Project } from '../types/project'
import type {
  ItemPlaceholder,
  TranslateBatch,
  TranslateBatchResult,
  TranslateItem,
  TranslationBudget,
  TranslationCandidate,
  TranslationEvent,
  TranslationIssue,
  TranslationJob,
  TranslationJobItem,
  TranslationOptions,
  TranslationRejection,
  TranslationResult,
  TranslationRun,
  TranslationSkip,
  TranslationSkipReason,
  TranslationUsage,
  TranslationWrite,
  Translator,
  TranslatorContext,
  TranslatorEstimate,
  TranslatorPrompt,
} from '../types/translate'
import type { PromptData, PromptItem } from './prompt'
import { errors } from '../errors'
import { hashText } from '../text'
import { checkSetting } from './analysis'
import { createPlaceholderComparer } from './batch'

/** Recorded in provenance and the cache key; bump when the rendered prompt changes in a way that changes output. */
export const TRANSLATOR_PROMPT_VERSION = '1'

const DEFAULT_CONCURRENCY = 4

export interface TranslationDeps {
  readonly project: Project
  readonly config: ResolvedConfig
  readonly registry: PluginRegistry
  readonly host: Host
}

/** One message of a job: what it needs and where it stands. */
interface Work {
  readonly key: KeyString
  readonly locale: LocaleCode
  readonly item: PromptItem
  readonly write: TranslationWrite
  readonly chain: readonly Translator[]
  readonly kind: 'fresh' | 'update' | 'cached'
  readonly cacheKey: string | undefined
  readonly cached?: { readonly value: string, readonly translator: string, readonly model?: string | undefined } | undefined
}

interface LocalePart {
  readonly data: PromptData
}

interface JobState {
  readonly work: readonly Work[]
  readonly skipped: readonly TranslationSkip[]
  readonly locales: ReadonlyMap<LocaleCode, LocalePart>
  readonly options: TranslationOptions
}

interface CachedAnswer {
  readonly value?: string | undefined
  readonly translator?: string | undefined
  readonly model?: string | undefined
  readonly rejected?: boolean | undefined
}

/** Word-level diff in `[-removed-] {+added+}` form. */
export function wordDiff(before: string, after: string): string {
  const x = before.split(/\s+/).filter(Boolean)
  const y = after.split(/\s+/).filter(Boolean)
  const lcs = Array.from({ length: x.length + 1 }, () => Array.from<number>({ length: y.length + 1 }).fill(0))
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i]![j] = x[i] === y[j]
        ? lcs[i + 1]![j + 1]! + 1
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: string[] = []
  let removed: string[] = []
  let added: string[] = []
  const flush = (): void => {
    if (removed.length > 0)
      out.push(`[-${removed.join(' ')}-]`)
    if (added.length > 0)
      out.push(`{+${added.join(' ')}+}`)
    removed = []
    added = []
  }
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      flush()
      out.push(x[i++]!)
      j++
    }
    else if (j < y.length && (i >= x.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      added.push(y[j++]!)
    }
    else {
      removed.push(x[i++]!)
    }
  }
  flush()
  return out.join(' ')
}

interface Masked {
  readonly text: string
  readonly placeholders: readonly ItemPlaceholder[]
  /** Turns the translator's text back into a message value. */
  readonly restore: (text: string) => string
}

const XML_TOKEN = /<x\s+id\s*=\s*"(\d+)"\s*\/>/g
const BRACKET_TOKEN = /⟦\s*(\d+)\s*⟧/g

/** Replaces placeholders with the tokens a translator wants. The same placeholder text shares one token. */
export function maskPlaceholders(text: string, found: readonly Placeholder[], mode: 'xml' | 'token' | 'raw'): Masked {
  const sorted = [...found].sort((a, b) => a.range.start - b.range.start)
  // Placeholders of several syntaxes can overlap (`{{name}}` and `{name}`); keep the outer one.
  const spans: Placeholder[] = []
  for (const p of sorted) {
    const last = spans.at(-1)
    if (last && p.range.start < last.range.end) {
      if (p.range.end - p.range.start > last.range.end - last.range.start)
        spans[spans.length - 1] = p
      continue
    }
    spans.push(p)
  }
  const ids = new Map<string, number>()
  const placeholders: ItemPlaceholder[] = []
  const tokenOf = (id: number): string => mode === 'xml'
    ? `<x id="${id}"/>`
    : `⟦${id}⟧`
  for (const p of spans) {
    if (ids.has(p.text))
      continue
    ids.set(p.text, ids.size)
    placeholders.push({
      token: mode === 'raw'
        ? p.text
        : tokenOf(ids.size - 1),
      raw: p.text,
      syntax: p.syntax,
    })
  }
  if (mode === 'raw') {
    return {
      text,
      placeholders,
      restore: value => value,
    }
  }
  let masked = ''
  let at = 0
  for (const p of spans) {
    masked += text.slice(at, p.range.start) + tokenOf(ids.get(p.text)!)
    at = p.range.end
  }
  masked += text.slice(at)
  const byId = placeholders.map(p => p.raw)
  const pattern = mode === 'xml'
    ? XML_TOKEN
    : BRACKET_TOKEN
  return {
    text: masked,
    placeholders,
    restore: value => value.replace(pattern, (token, id: string) => byId[Number(id)] ?? token),
  }
}

/** Whether a glossary term occurs in a text as a whole word, ignoring case. */
function mentions(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' })
  }
  catch {
    return undefined
  }
})()

function languageName(locale: LocaleCode, display: string | undefined): string {
  if (display)
    return display
  try {
    return languageNames?.of(locale.replace(/_/g, '-')) ?? locale
  }
  catch {
    return locale
  }
}

type PromptInput = Omit<TranslateBatch, 'prompt' | 'signal'> & { readonly mode: Translator['features']['placeholders'] }

/** The request for LLM translators: rules and terminology in the system prompt, the items as JSON. */
export function renderTranslatorPrompt(batch: PromptInput): TranslatorPrompt {
  const from = `${languageName(batch.from, batch.fromInfo.displayName)} (${batch.from})`
  const to = `${languageName(batch.to, batch.toInfo.displayName)} (${batch.to})`
  const placeholderRule = batch.mode === 'raw'
    ? 'Each item lists its placeholders. Keep every one exactly as written, as many times as in the source; never translate, change, drop or invent one. You may move a placeholder to fit the grammar.'
    : batch.mode === 'xml'
      ? 'Tags such as <x id="0"/> stand for placeholders. Keep every tag exactly as written, as many times as in the source; you may move a tag to fit the grammar.'
      : 'Tokens such as ⟦0⟧ stand for placeholders. Keep every token exactly as written, as many times as in the source; you may move a token to fit the grammar.'
  const rules = [
    placeholderRule,
    ...batch.rules,
    'A "description" tells what a message means or where it appears: follow it, and do not translate it. "context" is code around a usage, and "related" holds the message in related locales: both are references, not text to translate.',
    'An item with "previous" was translated before, and its source changed as the diff shows ([-removed-] {+added+}): change the previous translation only where the diff affects it, and copy the rest character for character.',
    'An item with "retry" failed automatic checks: translate it again from the source and fix the listed problems.',
    'Output only the translation of each item, with no notes, quotes or explanations.',
  ]
  const system = [
    `You translate ${batch.subject ?? 'the messages of a software project'} from ${from} into ${to}. Your output is a first draft that a human reviews, so be accurate and natural, and never add content that is not in the source.`,
    '',
    'Rules:',
    ...rules.map((rule, i) => `${i + 1}. ${rule}`),
  ]
  if (batch.glossary.length > 0) {
    system.push('', 'Terminology (apply these decisions consistently):', ...batch.glossary.map((entry) => {
      const note = entry.note
        ? ` (${entry.note})`
        : ''
      if (entry.doNotTranslate)
        return `- "${entry.term}"${note}: keep as is, do not translate`
      return entry.translation
        ? `- "${entry.term}"${note}: translate as "${entry.translation}"`
        : `- "${entry.term}"${note}: translate according to this meaning`
    }))
  }
  if (batch.examples.length > 0)
    system.push('', `Existing ${to} messages (style reference):`, ...batch.examples.map(e => `- ${JSON.stringify(e.source)} → ${JSON.stringify(e.target)}`))
  system.push('', 'Respond with JSON: {"translations": [{"id": "<id of the item>", "text": "<translation>"}]}, one entry per item.')
  const items = batch.items.map(item => ({
    id: item.id,
    text: item.text,
    ...item.placeholders.length > 0 && {
      placeholders: item.placeholders.map(p => p.token),
    },
    ...item.description !== undefined && { description: item.description },
    ...item.context && item.context.length > 0 && {
      context: item.context.map(c => c.snippet),
    },
    ...item.related && item.related.length > 0 && {
      related: Object.fromEntries(item.related.map(r => [r.locale, r.value])),
    },
    ...item.previous && { previous: item.previous },
    ...item.retry && { retry: item.retry },
  }))
  return {
    system: system.join('\n'),
    user: `Translate ${items.length === 1
      ? 'this message'
      : `these ${items.length} messages`}:\n${JSON.stringify(items, null, 1)}`,
    version: TRANSLATOR_PROMPT_VERSION,
  }
}

function addUsage(a: TranslationUsage | undefined, b: TranslationUsage): TranslationUsage {
  const sum = (x: number | undefined, y: number | undefined): number | undefined => x === undefined && y === undefined
    ? undefined
    : (x ?? 0) + (y ?? 0)
  const characters = sum(a?.characters, b.characters)
  const inputTokens = sum(a?.inputTokens, b.inputTokens)
  const outputTokens = sum(a?.outputTokens, b.outputTokens)
  const costUsd = sum(a?.costUsd, b.costUsd)
  return {
    requests: (a?.requests ?? 0) + b.requests,
    ...characters !== undefined && { characters },
    ...inputTokens !== undefined && { inputTokens },
    ...outputTokens !== undefined && { outputTokens },
    ...costUsd !== undefined && { costUsd: Math.round(costUsd * 1e8) / 1e8 },
  }
}

async function pool<T>(items: readonly T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({
    length: Math.min(Math.max(1, concurrency), items.length),
  }, async () => {
    while (next < items.length)
      await run(items[next++]!)
  }))
}

/** Splits items evenly into batches under both limits. */
function split<T>(items: readonly T[], size: (item: T) => number, maxItems: number, maxChars: number | undefined): T[][] {
  const byItems = Math.ceil(items.length / Math.max(1, maxItems))
  const chars = items.reduce((n, item) => n + size(item), 0)
  const byChars = maxChars
    ? Math.ceil(chars / Math.max(1, maxChars))
    : 1
  const count = Math.max(1, byItems, byChars)
  const even = Math.ceil(items.length / count)
  const out: T[][] = []
  for (let i = 0; i < items.length; i += even)
    out.push(items.slice(i, i + even))
  return out
}

/** An async iterable of events that a run pushes into. */
function channel<T>(): { push: (value: T) => void, close: () => void, iterable: AsyncIterable<T> } {
  const buffered: T[] = []
  const waiting: ((result: IteratorResult<T>) => void)[] = []
  let closed = false
  return {
    push(value) {
      const next = waiting.shift()
      if (next)
        next({ value, done: false })
      else
        buffered.push(value)
    },
    close() {
      closed = true
      for (const next of waiting.splice(0))
        next({ value: undefined, done: true })
    },
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (buffered.length > 0) {
            return Promise.resolve({
              value: buffered.shift()!,
              done: false,
            })
          }
          if (closed)
            return Promise.resolve({ value: undefined, done: true })
          return new Promise(resolve => waiting.push(resolve))
        },
      }),
    },
  }
}

const key = (at: { readonly key: KeyString, readonly locale: LocaleCode }): string => `${at.key}\u0000${at.locale}`

/** One message on its way through the chain. */
interface Attempt {
  readonly work: Work
  /** Index of the current translator in `work.chain`. */
  index: number
  /** Calls to the current translator. */
  tries: number
  output: string | undefined
  issues: TranslationIssue[]
  readonly tried: string[]
}

/** Messages with the same source, description and state, sent once and fanned out. */
type Unit = readonly Attempt[]

interface Answer {
  readonly text: string
  readonly declined: string | undefined
}

/** What a run needs, and what it collects. */
interface Run {
  readonly deps: TranslationDeps
  readonly state: JobState
  readonly signal: AbortSignal
  readonly emit: (event: TranslationEvent) => void
  readonly context: TranslatorContext
  readonly transforms: readonly NonNullable<Plugin['transformTranslation']>[]
  readonly verify: (work: Work, value: string) => TranslationIssue[]
  readonly retries: number
  readonly budget: TranslationBudget
  readonly candidates: TranslationCandidate[]
  readonly rejected: TranslationRejection[]
  readonly skipped: TranslationSkip[]
  readonly usage: Record<string, TranslationUsage>
  readonly models: Map<TranslationCandidate, string | undefined>
  spentUsd: number
  spentChars: number
  cancelled: boolean
}

function accept(run: Run, work: Work, value: string, translator: string, model: string | undefined, issues: readonly TranslationIssue[], cached: boolean): void {
  const candidate: TranslationCandidate = {
    key: work.key,
    locale: work.locale,
    value,
    translator,
    derived: work.kind === 'update'
      ? 'update'
      : 'fresh',
    issues: issues.filter(issue => issue.severity !== 'error'),
    // Without a review file there is nowhere to leave a suggestion.
    write: work.write === 'suggestion' && run.deps.project.reviewFile === undefined
      ? 'none'
      : work.write,
    cached,
  }
  run.candidates.push(candidate)
  run.models.set(candidate, model)
  run.emit({ type: 'candidate', candidate })
}

function reject(run: Run, attempt: Attempt): void {
  const rejection: TranslationRejection = {
    key: attempt.work.key,
    locale: attempt.work.locale,
    translators: [
      ...new Set(attempt.tried),
    ],
    ...attempt.output !== undefined && { output: attempt.output },
    issues: attempt.issues,
  }
  run.rejected.push(rejection)
  run.emit({ type: 'rejected', rejection })
}

function translatorOf(attempt: Attempt): Translator {
  return attempt.work.chain[attempt.index]!
}

/** Splits attempts by translator and locale, so a batch reads like one screen. */
function groupAttempts(pending: readonly Attempt[]): Attempt[][] {
  const groups = new Map<string, Attempt[]>()
  for (const attempt of pending) {
    const id = `${translatorOf(attempt).id}\u0000${attempt.work.locale}`
    const list = groups.get(id) ?? []
    list.push(attempt)
    groups.set(id, list)
  }
  return [
    ...groups.values(),
  ]
}

function groupBy<T>(items: readonly T[], id: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const list = groups.get(id(item)) ?? []
    list.push(item)
    groups.set(id(item), list)
  }
  return [
    ...groups.values(),
  ]
}

/** Batches of one group: identical messages share a unit, and a namespace never shares a batch with another. */
function batchesOf(group: readonly Attempt[], translator: Translator, namespaced: boolean): Unit[][] {
  const units = groupBy(group, ({ work, issues }) => JSON.stringify([
    work.item.source,
    work.item.description ?? '',
    work.kind,
    work.item.existing ?? '',
    issues.length > 0,
  ]))
  const namespaceOf = (unit: Unit): string => {
    const k = unit[0]!.work.key
    return namespaced
      ? k.slice(0, Math.max(0, k.indexOf(':')))
      : ''
  }
  const { maxItems, maxChars } = translator.features.batch
  return groupBy(units, namespaceOf).flatMap(list => split(list, unit => unit[0]!.work.item.source.length, maxItems, maxChars))
}

function itemFor(unit: Unit, index: number, masked: Masked, translator: Translator): TranslateItem {
  const attempt = unit[0]!
  const { item, kind } = attempt.work
  const { context, feedback } = translator.features
  const retry = feedback && attempt.output !== undefined && attempt.issues.length > 0 && attempt.tried.at(-1) === translator.id
  const previous = kind === 'update' && item.previousSource !== undefined && item.existing !== undefined
    ? {
        source: item.previousSource,
        translation: item.existing,
        diff: wordDiff(item.previousSource, item.source),
      }
    : undefined
  return {
    id: `m${index + 1}`,
    key: attempt.work.key,
    text: masked.text,
    placeholders: masked.placeholders,
    ...context && item.description !== undefined && { description: item.description },
    ...context && item.context.length > 0 && { context: item.context },
    ...context && item.related && { related: item.related },
    ...previous && { previous },
    ...retry && {
      retry: {
        output: attempt.output!,
        problems: attempt.issues.filter(issue => issue.severity === 'error').map(issue => issue.message),
      },
    },
  }
}

function requestFor(run: Run, batch: readonly Unit[], masks: readonly Masked[], translator: Translator, locale: LocaleCode): TranslateBatch {
  const { project, config } = run.deps
  const { data } = run.state.locales.get(locale)!
  const { context, glossary: glossaryMode, placeholders: mode } = translator.features
  const sources = batch.map(unit => unit[0]!.work.item.source).join('\n')
  const base = {
    from: project.sourceLocale,
    to: locale,
    fromInfo: project.localeInfo(project.sourceLocale),
    toInfo: project.localeInfo(locale),
    items: batch.map((unit, i) => itemFor(unit, i, masks[i]!, translator)),
    glossary: glossaryMode === 'none'
      ? []
      : data.glossary.filter(entry => mentions(sources, entry.term)),
    // A translator replies with every item; the prompt's "leave the key out" rule is for agents.
    rules: context
      ? [
          ...data.rules.filter(rule => !rule.includes('leave the key out')),
          ...data.notes,
          ...config.translate.rules['*'] ?? [],
          ...config.translate.rules[locale] ?? [],
        ]
      : [],
    examples: context
      ? data.examples.map(e => ({ source: e.source, target: e.target }))
      : [],
    subject: config.translate.subject,
  }
  return {
    ...base,
    prompt: renderTranslatorPrompt({ ...base, mode }),
    signal: run.signal,
  }
}

function overBudget(run: Run, translator: Translator, characters: number): boolean {
  if (!translator.features.paid)
    return false
  const { usd, characters: limit } = run.budget
  return (usd !== undefined && run.spentUsd >= usd) || (limit !== undefined && run.spentChars + characters > limit)
}

async function call(run: Run, translator: Translator, request: TranslateBatch, characters: number): Promise<{ reply: TranslateBatchResult | undefined, failure: string | undefined }> {
  let reply: TranslateBatchResult | undefined
  let failure: string | undefined
  try {
    reply = await translator.translate(request, run.context)
  }
  catch (error) {
    failure = error instanceof Error
      ? error.message
      : String(error)
    run.deps.host.logger?.warn(`Translator ${translator.id} failed: ${failure}`)
  }
  const spent = reply?.usage ?? { requests: 1 }
  const counted = { ...spent, characters: spent.characters ?? characters }
  run.usage[translator.id] = addUsage(run.usage[translator.id], counted)
  run.spentUsd += counted.costUsd ?? 0
  run.spentChars += characters
  run.emit({ type: 'usage', translator: translator.id, usage: counted })
  return { reply, failure }
}

/** After a failure: the same translator again (with feedback), the next one, or a rejection. */
function moveOn(run: Run, attempt: Attempt, next: Attempt[], issues: TranslationIssue[], output: string | undefined, retry: boolean): void {
  attempt.issues = issues
  attempt.output = output
  if (retry && translatorOf(attempt).features.feedback && attempt.tries <= run.retries) {
    next.push(attempt)
    return
  }
  attempt.index++
  attempt.tries = 0
  if (attempt.index < attempt.work.chain.length)
    next.push(attempt)
  else
    reject(run, attempt)
}

function settle(run: Run, attempt: Attempt, answer: Answer | undefined, outcome: { failure: string | undefined, model: string | undefined, masked: Masked }, next: Attempt[]): void {
  const translator = translatorOf(attempt)
  const { work } = attempt
  attempt.tried.push(translator.id)
  attempt.tries++
  if (outcome.failure !== undefined) {
    return moveOn(run, attempt, next, [
      { code: 'translator-error', severity: 'error', message: outcome.failure },
    ], undefined, false)
  }
  if (!answer) {
    // A message with a reported problem may be right as it is; the prompt allows leaving it out.
    if (work.item.issues && work.item.existing !== undefined) {
      run.skipped.push({ key: work.key, locale: work.locale, reason: 'kept' })
      return
    }
    return moveOn(run, attempt, next, [
      { code: 'response', severity: 'error', message: 'Missing from the response.' },
    ], undefined, true)
  }
  if (answer.declined !== undefined) {
    return moveOn(run, attempt, next, [
      { code: 'declined', severity: 'error', message: answer.declined },
    ], undefined, false)
  }
  let value = outcome.masked.restore(answer.text.trim())
  for (const transform of run.transforms) {
    value = transform(value, {
      key: work.key,
      source: work.item.source,
      from: run.deps.project.sourceLocale,
      to: work.locale,
      translator: translator.id,
    })
  }
  const issues = run.verify(work, value)
  if (issues.some(issue => issue.severity === 'error'))
    return moveOn(run, attempt, next, issues, value, true)
  accept(run, work, value, translator.id, outcome.model, issues, false)
}

async function runBatch(run: Run, batch: readonly Unit[], translator: Translator, next: Attempt[]): Promise<void> {
  const all = batch.flat()
  const locale = all[0]!.work.locale
  const characters = batch.reduce((n, unit) => n + unit[0]!.work.item.source.length, 0)
  const stop: TranslationSkipReason | undefined = run.signal.aborted
    ? 'cancelled'
    : overBudget(run, translator, characters)
      ? 'budget'
      : undefined
  if (stop) {
    run.cancelled ||= stop === 'cancelled'
    run.skipped.push(...all.map(a => ({ key: a.work.key, locale: a.work.locale, reason: stop })))
    return
  }
  const { project } = run.deps
  const masks = batch.map((unit) => {
    const source = unit[0]!.work.item.source
    return maskPlaceholders(source, project.placeholderSyntaxes.flatMap(s => s.find(source)), translator.features.placeholders)
  })
  const request = requestFor(run, batch, masks, translator, locale)
  run.emit({
    type: 'batch-start',
    translator: translator.id,
    locale,
    items: all.length,
  })
  const { reply, failure } = await call(run, translator, request, characters)
  const answers = new Map<string, Answer>()
  for (const answer of reply?.items ?? []) {
    if (!answers.has(answer.id))
      answers.set(answer.id, { text: answer.text, declined: answer.declined })
  }
  batch.forEach((unit, i) => {
    const outcome = { failure, model: reply?.model, masked: masks[i]! }
    for (const attempt of unit)
      settle(run, attempt, answers.get(`m${i + 1}`), outcome, next)
  })
}

async function writeCache(run: Run): Promise<void> {
  const cache = run.deps.host.cache
  if (!cache)
    return
  const byKey = new Map(run.state.work.map(w => [
    key(w),
    w.cacheKey,
  ]))
  const writes: Promise<void>[] = []
  for (const c of run.candidates) {
    const cacheKey = byKey.get(key(c))
    if (!c.cached && cacheKey !== undefined) {
      writes.push(cache.set(cacheKey, JSON.stringify({
        value: c.value,
        translator: c.translator,
        model: run.models.get(c),
      } satisfies CachedAnswer)))
    }
  }
  for (const r of run.rejected) {
    const cacheKey = byKey.get(key(r))
    if (cacheKey !== undefined)
      writes.push(cache.set(cacheKey, JSON.stringify({ rejected: true } satisfies CachedAnswer)))
  }
  await Promise.all(writes)
}

/** Values are set with their provenance; suggestions are review comments by the translator. */
function opsOf(run: Run): EditOp[] {
  return run.candidates.flatMap((candidate): EditOp[] => {
    if (candidate.write === 'value') {
      const model = run.models.get(candidate)
      return [
        {
          type: 'set',
          key: candidate.key,
          locale: candidate.locale,
          value: candidate.value,
          machine: {
            translator: candidate.translator,
            ...model !== undefined && { model },
            prompt: TRANSLATOR_PROMPT_VERSION,
          },
        },
      ]
    }
    if (candidate.write === 'suggestion') {
      return [
        {
          type: 'review',
          key: candidate.key,
          locale: candidate.locale,
          review: 'suggestion',
          suggestion: candidate.value,
          author: { name: `x18n translate (${candidate.translator})` },
        },
      ]
    }
    return []
  })
}

async function execute(run: Run): Promise<TranslationResult> {
  for (const work of run.state.work) {
    if (work.cached)
      accept(run, work, work.cached.value, work.cached.translator, work.cached.model, run.verify(work, work.cached.value), true)
  }
  let pending: Attempt[] = run.state.work.filter(w => !w.cached).map(work => ({
    work,
    index: 0,
    tries: 0,
    output: undefined,
    issues: [],
    tried: [],
  }))
  while (pending.length > 0) {
    const next: Attempt[] = []
    for (const group of groupAttempts(pending)) {
      const translator = translatorOf(group[0]!)
      await pool(batchesOf(group, translator, run.deps.project.namespaced), translator.features.concurrency ?? DEFAULT_CONCURRENCY, batch => runBatch(run, batch, translator, next))
    }
    pending = next
  }
  const order = new Map(run.state.work.map((w, i) => [
    key(w),
    i,
  ]))
  const byOrder = (a: { key: KeyString, locale: LocaleCode }, b: { key: KeyString, locale: LocaleCode }): number => (order.get(key(a)) ?? -1) - (order.get(key(b)) ?? -1)
  run.candidates.sort(byOrder)
  run.rejected.sort(byOrder)
  run.skipped.sort(byOrder)
  await writeCache(run)
  return {
    candidates: run.candidates,
    rejected: run.rejected,
    skipped: run.skipped,
    usage: run.usage,
    cancelled: run.cancelled,
    plan: run.deps.project.plan(opsOf(run)),
  }
}

function placeholderIssues(syntaxes: readonly PlaceholderSyntax[], source: string, value: string): TranslationIssue[] {
  const issues: TranslationIssue[] = []
  const leftover = value.match(XML_TOKEN) ?? value.match(BRACKET_TOKEN)
  if (leftover)
    issues.push({ code: 'placeholder-mismatch', severity: 'error', message: `Unknown placeholder token ${leftover[0]}.` })
  const { missing, extra } = createPlaceholderComparer(syntaxes)(source, value)
  if (missing.length > 0 || extra.length > 0) {
    const parts = [
      missing.length > 0 && `missing ${missing.join(', ')}`,
      extra.length > 0 && `extra ${extra.join(', ')}`,
    ]
    issues.push({
      code: 'placeholder-mismatch',
      severity: 'error',
      message: parts.filter(Boolean).join('; '),
    })
  }
  for (const syntax of syntaxes) {
    const known = new Set(syntax.validate?.(source))
    for (const problem of syntax.validate?.(value) ?? []) {
      if (!known.has(problem))
        issues.push({ code: 'invalid-syntax', severity: 'error', message: problem })
    }
  }
  return issues
}

function checkIssues(deps: TranslationDeps, work: Work, value: string): TranslationIssue[] {
  const { project, config, registry } = deps
  const placeholders = (text: string): readonly Placeholder[] => project.placeholderSyntaxes.flatMap(s => s.find(text))
  const issues: TranslationIssue[] = []
  for (const check of registry.checks.values()) {
    const setting = checkSetting(check, config.checks)
    if (!check.message || setting.level === 'off')
      continue
    const level: Severity = setting.level
    const found = check.message({
      key: work.key,
      locale: work.locale,
      value,
      source: work.item.source,
      sourceLocale: project.sourceLocale,
      localeInfo: project.localeInfo(work.locale),
      sourceLocaleInfo: project.localeInfo(project.sourceLocale),
      placeholders,
      glossary: config.glossary,
      options: setting.options,
    })
    for (const diagnostic of found) {
      const severity = diagnostic.severity ?? level
      issues.push({
        code: check.id,
        severity: severity === 'hint'
          ? 'info'
          : config.strict && severity === 'warning'
            ? 'error'
            : severity,
        message: diagnostic.message,
      })
    }
  }
  return issues
}

/** Model-free checks of a candidate: placeholders, syntax, then the checks that judge one message. */
function verifyWith(deps: TranslationDeps): (work: Work, value: string) => TranslationIssue[] {
  return (work, value) => value.trim() === ''
    ? [
        { code: 'empty', severity: 'error', message: 'The translation is empty.' },
      ]
    : [
        ...placeholderIssues(deps.project.placeholderSyntaxes, work.item.source, value),
        ...checkIssues(deps, work, value),
      ]
}

function estimateOf(work: readonly Work[]): TranslatorEstimate[] {
  const fresh = work.filter(w => w.kind !== 'cached')
  return groupBy(fresh, w => w.chain[0]!.id).map((list) => {
    const first = list[0]!.chain[0]!
    const { maxItems, maxChars } = first.features.batch
    const batches = groupBy(list, w => w.locale).reduce((n, items) => n + split(items, w => w.item.source.length, maxItems, maxChars).length, 0)
    return {
      translator: first.id,
      items: list.length,
      characters: list.reduce((n, w) => n + w.item.source.length, 0),
      batches,
      paid: first.features.paid,
    }
  })
}

export interface Translation {
  readonly planTranslation: (options: TranslationOptions) => Promise<TranslationJob>
  readonly translate: (job: TranslationJob, options?: { readonly signal?: AbortSignal | undefined }) => TranslationRun
}

export function createTranslation(deps: TranslationDeps): Translation {
  const { project, config, registry, host } = deps
  const jobs = new WeakMap<TranslationJob, JobState>()
  const transforms = registry.plugins.flatMap(plugin => plugin.transformTranslation
    ? [plugin.transformTranslation]
    : [])
  const verify = verifyWith(deps)

  const context: TranslatorContext = {
    secret: ref => typeof ref === 'string'
      ? ref
      : host.env?.(ref.env),
    logger: host.logger,
    cache: host.cache,
  }

  function chainFor(locale: LocaleCode, options: TranslationOptions): Translator[] {
    const ids = [
      ...registry.translators.keys(),
    ]
    const list = options.translators ?? config.translate.locales[locale] ?? config.translate.translators ?? ids
    return list.map((entry) => {
      if (typeof entry !== 'string')
        return entry
      const found = registry.translators.get(entry)
      if (!found)
        throw errors.X18N6002({ id: entry, available: ids })
      return found
    })
  }

  /** The chain of a locale, without the translators that do not serve the pair. */
  async function supportedChain(locale: LocaleCode, options: TranslationOptions): Promise<Translator[]> {
    const chain = chainFor(locale, options)
    if (chain.length === 0)
      throw errors.X18N6001({ locale })
    const supported: Translator[] = []
    for (const translator of chain) {
      if (await (translator.supports?.({ from: project.sourceLocale, to: locale }, context) ?? true))
        supported.push(translator)
    }
    return supported
  }

  function cacheKeyOf(chain: readonly Translator[], locale: LocaleCode, item: PromptItem, kind: 'fresh' | 'update'): string {
    return `translate:${hashText(JSON.stringify({
      v: TRANSLATOR_PROMPT_VERSION,
      chain: chain.map(t => [t.id, t.fingerprint ?? '']),
      from: project.sourceLocale,
      to: locale,
      source: item.source,
      description: item.description ?? '',
      previous: kind === 'update'
        ? [item.previousSource, item.existing]
        : undefined,
    }))}`
  }

  async function readCache(cacheKey: string | undefined): Promise<CachedAnswer | undefined> {
    const text = cacheKey === undefined
      ? undefined
      : await host.cache?.get(cacheKey)
    if (text === undefined)
      return undefined
    try {
      return JSON.parse(text) as CachedAnswer
    }
    catch {
      return undefined
    }
  }

  const readOnly = (k: KeyString, locale: LocaleCode): boolean => {
    const message = project.message(k, locale)
    return message !== undefined && project.resources.find(r => r.id === message.resource)?.readonly === true
  }

  /** The work for one message, or why it is skipped. */
  async function planItem(item: PromptItem, locale: LocaleCode, chain: readonly Translator[], options: TranslationOptions): Promise<Work | 'cached-rejection'> {
    const requested = options.write ?? 'value'
    const write: TranslationWrite = requested === 'value' && item.existing !== undefined && !options.overwrite
      ? 'suggestion'
      : requested
    const kind = item.previousSource !== undefined && item.existing !== undefined && chain[0]!.features.update
      ? 'update'
      : 'fresh'
    const cacheKey = (options.cache ?? config.translate.cache) && host.cache
      ? cacheKeyOf(chain, locale, item, kind)
      : undefined
    const answer = await readCache(cacheKey)
    if (answer?.rejected && !options.retryRejected)
      return 'cached-rejection'
    const cached = answer?.value !== undefined && answer.translator !== undefined
      ? { value: answer.value, translator: answer.translator, model: answer.model }
      : undefined
    return {
      key: item.key,
      locale,
      item,
      write,
      chain,
      kind: cached
        ? 'cached'
        : kind,
      cacheKey,
      cached,
    }
  }

  async function planTranslation(options: TranslationOptions): Promise<TranslationJob> {
    await project.ready
    const source = project.sourceLocale
    const targets = options.to === 'all'
      ? project.locales.filter(locale => locale !== source)
      : options.to
    const unknown = targets.find(locale => !project.locales.includes(locale) || locale === source)
    if (unknown !== undefined)
      throw errors.X18N4008({ reason: `"${unknown}" is not a target locale (${project.locales.filter(l => l !== source).join(', ')})` })
    const limit = options.limit ?? config.translate.limit
    const work: Work[] = []
    const skipped: TranslationSkip[] = []
    const locales = new Map<LocaleCode, LocalePart>()
    for (const locale of targets) {
      const chain = await supportedChain(locale, options)
      const data = project.prompt('translate', locale, {
        keys: options.keys,
        namespace: options.namespace,
        stale: options.stale,
        check: options.check,
        limit: Number.MAX_SAFE_INTEGER,
      })
      locales.set(locale, { data })
      for (const item of data.items) {
        const at = { key: item.key, locale }
        const early: TranslationSkipReason | undefined = chain.length === 0
          ? 'unsupported-pair'
          : readOnly(item.key, locale)
            ? 'read-only'
            : work.length >= limit
              ? 'limit'
              : undefined
        const planned = early ?? await planItem(item, locale, chain, options)
        if (typeof planned === 'string')
          skipped.push({ ...at, reason: planned })
        else
          work.push(planned)
      }
    }
    const items: TranslationJobItem[] = work.map(w => ({
      key: w.key,
      locale: w.locale,
      translator: w.cached?.translator ?? w.chain[0]!.id,
      kind: w.kind,
    }))
    const job: TranslationJob = {
      id: hashText(JSON.stringify({ revision: project.revision, items, skipped })),
      revision: project.revision,
      items,
      skipped,
      estimate: estimateOf(work),
    }
    jobs.set(job, { work, skipped, locales, options })
    return job
  }

  function translate(job: TranslationJob, runOptions: { readonly signal?: AbortSignal | undefined } = {}): TranslationRun {
    const state = jobs.get(job)
    if (!state)
      throw errors.X18N4008({ reason: 'the job was not planned by this project' })
    if (job.revision !== project.revision)
      throw errors.X18N4004()
    const events = channel<TranslationEvent>()
    const result = execute({
      deps,
      state,
      signal: runOptions.signal ?? new AbortController().signal,
      emit: events.push,
      context,
      transforms,
      verify,
      retries: state.options.retries ?? config.translate.retries,
      budget: state.options.budget ?? config.translate.budget,
      candidates: [],
      rejected: [],
      skipped: [...state.skipped],
      usage: {},
      models: new Map(),
      spentUsd: 0,
      spentChars: 0,
      cancelled: false,
    }).finally(events.close)
    return {
      result,
      [Symbol.asyncIterator]: () => events.iterable[Symbol.asyncIterator](),
    }
  }

  return { planTranslation, translate }
}
