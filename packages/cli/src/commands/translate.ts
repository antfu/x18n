import type { TranslationJob, TranslationResult, TranslationWrite } from '@x18n/core'
import type { GlobalOptions } from '../context'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { errors } from '@x18n/core'
import { openWorkspace, out, printJson, runPlan, singleProject } from '../context'

export interface TranslateCommandOptions extends GlobalOptions {
  /** Comma separated, or repeated; `all` for every target locale. */
  readonly to?: string | readonly string[] | undefined
  readonly keys?: string | undefined
  readonly namespace?: string | undefined
  readonly stale?: boolean | undefined
  /** `true` for a bare `--check`, else the comma separated check ids. */
  readonly check?: boolean | string | undefined
  readonly translator?: string | undefined
  readonly limit?: number | undefined
  readonly budgetUsd?: number | undefined
  readonly write?: string | undefined
  readonly overwrite?: boolean | undefined
  readonly retryRejected?: boolean | undefined
  readonly estimate?: boolean | undefined
  readonly dryRun?: boolean | undefined
}

const list = (value: string | readonly string[] | undefined): string[] => [value ?? []].flat().flatMap(v => String(v).split(',')).map(v => v.trim()).filter(Boolean)

function estimateText(job: TranslationJob): string {
  if (job.items.length === 0)
    return 'Nothing to translate.'
  const cached = job.items.filter(item => item.kind === 'cached').length
  const lines = job.estimate.map(e => `  ${e.translator}: ${e.items} messages, ${e.characters} characters, ${e.batches} ${e.batches === 1
    ? 'request'
    : 'requests'}${e.paid
    ? ''
    : ' (free)'}`)
  if (cached > 0)
    lines.push(`  cache: ${cached} messages`)
  return [`Translate ${job.items.length} messages:`, ...lines].join('\n')
}

function skippedText(skipped: TranslationResult['skipped']): string[] {
  const counts = new Map<string, number>()
  for (const skip of skipped)
    counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1)
  return [...counts].map(([reason, n]) => `  skipped ${n} (${reason})`)
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return /^y(?:es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  }
  finally {
    rl.close()
  }
}

/** `x18n translate --to <locales>`: translate missing messages with the configured translators. */
export async function translate(options: TranslateCommandOptions): Promise<number | void> {
  const targets = list(options.to)
  if (targets.length === 0)
    throw errors.X18N0001({ issue: 'pass --to <locale> (comma separated, or `all`)' })
  const write = options.write ?? 'value'
  if (write !== 'value' && write !== 'suggestion' && write !== 'none')
    throw errors.X18N0001({ issue: `--write must be value, suggestion or none, not "${write}"` })
  const check = typeof options.check === 'string'
    ? list(options.check)
    : options.check
  const loaded = singleProject(await openWorkspace(options))
  const { project, host } = loaded
  if (options.stale || check === true || (Array.isArray(check) && check.includes('stale-translation')))
    await project.loadHistory()
  const translators = list(options.translator)
  const job = await project.planTranslation({
    to: targets.includes('all')
      ? 'all'
      : targets,
    keys: options.keys,
    namespace: options.namespace,
    stale: options.stale,
    check,
    translators: translators.length > 0
      ? translators
      : undefined,
    write: write as TranslationWrite,
    overwrite: options.overwrite,
    limit: options.limit === undefined
      ? undefined
      : Number(options.limit),
    budget: options.budgetUsd === undefined
      ? undefined
      : {
          usd: Number(options.budgetUsd),
        },
    cache: options.cache === false
      ? false
      : undefined,
    retryRejected: options.retryRejected,
  })
  const estimate = {
    items: job.items,
    skipped: job.skipped,
    estimate: job.estimate,
  }
  if (options.estimate) {
    if (options.json) {
      printJson('translate', { ...estimate, estimated: true })
    }
    else {
      out([
        estimateText(job),
        ...skippedText(job.skipped),
      ].join('\n'))
    }
    return
  }
  const paid = job.estimate.some(e => e.paid && e.items > 0)
  if (paid && !options.yes && !options.json && process.stdin.isTTY && !(await confirm(`${estimateText(job)}\nContinue?`)))
    return 1
  const run = project.translate(job)
  for await (const event of run) {
    if (options.json)
      continue
    if (event.type === 'batch-start')
      process.stderr.write(`${event.translator} → ${event.locale}: ${event.items} messages\n`)
    else if (event.type === 'rejected')
      process.stderr.write(`rejected ${event.rejection.key} (${event.rejection.locale}): ${event.rejection.issues.map(i => i.message).join('; ')}\n`)
  }
  const result = await run.result
  await host.flush()
  const data = {
    estimate: job.estimate,
    candidates: result.candidates,
    rejected: result.rejected,
    skipped: result.skipped,
    usage: result.usage,
    cancelled: result.cancelled,
  }
  const cost = Object.values(result.usage).reduce((sum, u) => sum + (u.costUsd ?? 0), 0)
  await runPlan('translate', loaded, result.plan, options, {
    data,
    text: (applied) => {
      const values = result.candidates.filter(c => c.write === 'value').length
      const suggestions = result.candidates.filter(c => c.write === 'suggestion').length
      const verb = applied
        ? ''
        : 'would '
      return [
        `${result.candidates.length} translated: ${verb}write ${values} ${values === 1
          ? 'value'
          : 'values'} (marked as machine-translated), ${verb}suggest ${suggestions}.`,
        ...result.rejected.length > 0
          ? [`  rejected ${result.rejected.length}: ${result.rejected.map(r => `${r.key} (${r.locale})`).join(', ')}`]
          : [],
        ...skippedText(result.skipped),
        ...cost > 0
          ? [`  cost: $${cost.toFixed(4)}`]
          : [],
        ...applied && values > 0
          ? ['Review them with `x18n review approve --machine --locale <locale>`.']
          : [],
      ].join('\n')
    },
  })
  return result.rejected.length > 0
    ? 1
    : undefined
}

/** `x18n translators`: the translators of the plugins and the chain per target locale. */
export async function translators(options: GlobalOptions): Promise<void> {
  const loaded = singleProject(await openWorkspace(options))
  const { project } = loaded
  const configured = project.config.translate
  const ids = [
    ...project.translators.keys(),
  ]
  const chains = project.locales.filter(locale => locale !== project.sourceLocale).map(locale => ({
    locale,
    chain: configured.locales[locale] ?? configured.translators ?? ids,
  }))
  const data = {
    translators: [
      ...project.translators.values(),
    ].map(t => ({ id: t.id, features: t.features })),
    chains,
  }
  if (options.json) {
    printJson('translators', data)
    return
  }
  if (ids.length === 0) {
    out('No translators. Add a translator plugin, such as `@x18n/translator-ai`.')
    return
  }
  for (const t of project.translators.values()) {
    const f = t.features
    out(`${t.id}  placeholders: ${f.placeholders}, context: ${f.context
      ? 'yes'
      : 'no'}, glossary: ${f.glossary}, batch: ${f.batch.maxItems}${f.paid
      ? ''
      : ', free'}`)
  }
  for (const { locale, chain } of chains)
    out(`  ${locale}: ${chain.join(' → ')}`)
}
