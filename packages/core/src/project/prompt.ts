import type { ResolvedConfig } from '../types/config'
import type { Diagnostic, KeyString, LocaleCode, MessageLeaf } from '../types/model'
import type { PromptContext, PromptDraft } from '../types/plugin'
import type { Project } from '../types/project'
import { keyMatcher } from '../keys'
import { createLineIndex } from '../text'

export interface PromptOptions {
  /** Key glob, or a list of keys. */
  readonly keys?: string | readonly KeyString[] | undefined
  readonly namespace?: string | undefined
  /** Items per prompt. Default 50. */
  readonly limit?: number | undefined
  /** Offset from `nextCursor` of the previous prompt. */
  readonly cursor?: string | undefined
  /** Include code around usages. Default true. */
  readonly context?: boolean | undefined
  /** Translate prompts: add stale translations (load history first). */
  readonly stale?: boolean | undefined
  /** Translate prompts: add translations that checks report in the target locale, all of them (`true`) or of these check ids. */
  readonly check?: boolean | readonly string[] | undefined
}

export interface PromptIssue {
  /** Check id, for example `identical-to-source`. */
  readonly code: string
  readonly message: string
}

export interface UsageContext {
  readonly path: string
  readonly line: number
  readonly snippet: string
}

export interface PromptItem {
  readonly key: KeyString
  readonly source: string
  readonly placeholders: readonly string[]
  /** The current value in the target locale, when there is one. */
  readonly existing: string | undefined
  /** For a stale translation: the source value when the translation last changed, when known. */
  readonly previousSource?: string | undefined
  /** With `check`: what the checks report for the current value. */
  readonly issues?: readonly PromptIssue[] | undefined
  readonly context: readonly UsageContext[]
}

export interface PromptData {
  readonly kind: 'translate' | 'review'
  readonly project: string
  readonly from: LocaleCode
  readonly to: LocaleCode
  readonly targetName: string | undefined
  readonly total: number
  readonly remaining: number
  readonly nextCursor: string | undefined
  readonly rules: readonly string[]
  readonly notes: readonly string[]
  readonly glossary: readonly { readonly term: string, readonly translation: string | undefined, readonly note: string | undefined, readonly doNotTranslate: boolean }[]
  readonly examples: readonly { readonly key: KeyString, readonly source: string, readonly target: string }[]
  readonly items: readonly PromptItem[]
  readonly instructions: readonly string[]
}

function text(value: MessageLeaf | undefined): string | undefined {
  return value === undefined || value === null
    ? undefined
    : String(value)
}

function contextOf(project: Project, key: KeyString): UsageContext[] {
  return project.usages({ key }).slice(0, 2).flatMap(({ usage }) => {
    const source = project.text(usage.path)
    if (source === undefined)
      return []
    const index = createLineIndex(source)
    const line = index.position(usage.range.start).line
    const lines = [line - 1, line, line + 1].filter(n => n >= 0 && n < index.lineCount).map(n => index.line(n))
    return [
      {
        path: usage.path,
        line: line + 1,
        snippet: lines.join('\n'),
      },
    ]
  })
}

/** The diagnostics of checks (all, or these ids) on values the locale has, by key. */
function reportedValues(project: Project, diagnostics: readonly Diagnostic[], to: LocaleCode, check: true | readonly string[]): Map<KeyString, Diagnostic[]> {
  const codes = check === true
    ? undefined
    : new Set(check)
  const reported = new Map<KeyString, Diagnostic[]>()
  for (const diagnostic of diagnostics) {
    if (diagnostic.key === undefined || diagnostic.locale !== to || (codes && !codes.has(diagnostic.code)))
      continue
    // A missing or empty value is on the page anyway; the report would only say so.
    if (!text(project.message(diagnostic.key, to)?.value))
      continue
    const found = reported.get(diagnostic.key) ?? []
    reported.set(diagnostic.key, found)
    found.push(diagnostic)
  }
  return reported
}

export interface PromptHooks {
  readonly config: ResolvedConfig
  readonly hooks: readonly ((draft: PromptDraft, ctx: PromptContext) => void)[]
}

/** Builds the parts of a translate or review prompt from project state. */
export function buildPrompt(project: Project, kind: 'translate' | 'review', to: LocaleCode, options: PromptOptions, extra: PromptHooks): PromptData {
  const from = project.sourceLocale
  const match = typeof options.keys === 'string'
    ? keyMatcher([options.keys])
    : undefined
  const list = Array.isArray(options.keys)
    ? new Set(options.keys)
    : undefined
  const analysis = project.analyze()
  const outdated = new Set(analysis.coverage.find(c => c.locale === to)?.outdated)
  const stale = (key: KeyString): boolean => outdated.has(key)
  const reported = kind === 'translate' && options.check
    ? reportedValues(project, analysis.diagnostics, to, options.check)
    : new Map<KeyString, Diagnostic[]>()
  const candidates = project.keys({ namespace: options.namespace }).filter((key) => {
    if (match && !match(key))
      return false
    if (list && !list.has(key))
      return false
    const source = text(project.message(key, from)?.value)
    if (source === undefined || source === '')
      return false
    const target = text(project.message(key, to)?.value)
    if (kind === 'review')
      return target !== undefined && target !== ''
    return list !== undefined || target === undefined || target === '' || (options.stale === true && stale(key)) || reported.has(key)
  })
  const start = Number(options.cursor ?? 0) || 0
  const limit = options.limit ?? 50
  const page = candidates.slice(start, start + limit)
  const end = start + page.length
  const syntaxes = project.placeholderSyntaxes
  const info = project.localeInfo(to)

  const draft: PromptDraft = { rules: [], notes: [] }
  if (syntaxes.length > 0)
    draft.rules.push(`Keep every placeholder exactly as written (${syntaxes.map(s => `\`${s.example ?? s.id}\``).join(', ')}); do not translate their names.`)
  draft.rules.push(
    'Keep markup tags and their attributes as they are.',
    'Match the tone and wording of the existing messages in the target locale.',
    'Do not translate glossary terms marked "do not translate".',
  )
  if (reported.size > 0)
    draft.rules.push(`A message with a reported problem has a current ${to} value: fix the problem. When the current value is right as it is, such as a word that is the same in both languages, leave the key out of the results.`)
  if (info.pluralCategories.length > 1)
    draft.notes.push(`${to} uses the plural categories ${info.pluralCategories.join(', ')}.`)
  for (const hook of extra.hooks)
    hook(draft, { sourceLocale: from, targetLocale: to, localeInfo: info })

  const examples = kind === 'translate'
    ? project.keys().flatMap((key) => {
        const source = text(project.message(key, from)?.value)
        const target = text(project.message(key, to)?.value)
        // A copy of the source says nothing about the target language, and tells the model that copying is fine.
        return source && target && target !== source && !candidates.includes(key)
          ? [
              { key, source, target },
            ]
          : []
      }).slice(0, 5)
    : []

  const items = page.map((key): PromptItem => {
    const source = text(project.message(key, from)?.value) ?? ''
    const translated = project.history(key, to)
    const previous = translated && stale(key)
      ? text(project.valueAt(key, from, translated.updatedAt))
      : undefined
    return {
      key,
      source,
      placeholders: [
        ...new Set(syntaxes.flatMap(s => s.find(source)).map(p => p.text)),
      ],
      existing: text(project.message(key, to)?.value) || undefined,
      previousSource: previous === source
        ? undefined
        : previous,
      issues: reported.get(key)?.map(d => ({ code: d.code, message: d.message })),
      context: options.context === false
        ? []
        : contextOf(project, key),
    }
  })

  const nextCursor = end < candidates.length
    ? String(end)
    : undefined
  const instructions = kind === 'translate'
    ? [
        `Write a JSON file \`{ "${to}": { "<key>": "<translation>" } }\` and run \`x18n apply <file> --json\`, or run \`x18n set <key> --locale ${to} --value <text>\` per key.`,
        `Then run \`x18n check --only placeholder-mismatch,invalid-syntax --locale ${to} --json\` and fix the reported keys.`,
        nextCursor
          ? `${candidates.length - end} more keys remain: \`x18n prompt translate --to ${to} --cursor ${nextCursor}\`.`
          : `To find more work: \`x18n keys --missing ${to} --json --limit 50\`.`,
      ]
    : project.reviewFile === undefined
      ? [
          `Fix wrong translations with \`x18n set <key> --locale ${to} --value <text>\`, then list what you changed and why.`,
          `Then run \`x18n check --only placeholder-mismatch,invalid-syntax --locale ${to} --json\`.`,
        ]
      : [
          `Leave fixes for a human to accept: \`x18n review suggest <key> --locale ${to} --value <text> --text <why>\`. Keep every placeholder in the value.`,
          `For a problem without a clear fix, run \`x18n review request-change <key> --locale ${to} --text <why>\`.`,
          `Then list what you reviewed; \`x18n review list --locale ${to} --open\` shows the open reviews.`,
        ]

  return {
    kind,
    project: project.name,
    from,
    to,
    targetName: info.displayName,
    total: candidates.length,
    remaining: candidates.length - end,
    nextCursor,
    rules: draft.rules,
    notes: draft.notes,
    glossary: extra.config.glossary.map(entry => ({
      term: entry.term,
      translation: entry.translations?.[to],
      note: entry.note,
      doNotTranslate: entry.doNotTranslate === true,
    })),
    examples,
    items,
    instructions,
  }
}

function renderItem(item: PromptItem, to: LocaleCode): string[] {
  const out = [`### \`${item.key}\``, '', `- Source: ${JSON.stringify(item.source)}`]
  if (item.placeholders.length)
    out.push(`- Placeholders: ${item.placeholders.map(p => `\`${p}\``).join(', ')}`)
  if (item.previousSource !== undefined)
    out.push(`- Source when ${to} last changed: ${JSON.stringify(item.previousSource)}`)
  if (item.existing !== undefined)
    out.push(`- Current ${to}: ${JSON.stringify(item.existing)}`)
  for (const issue of item.issues ?? [])
    out.push(`- Reported: ${issue.message} (\`${issue.code}\`)`)
  for (const context of item.context)
    out.push(`- Used in \`${context.path}:${context.line}\`:`, '', '  ```', ...context.snippet.split('\n').map(line => `  ${line}`), '  ```')
  out.push('')
  return out
}

/** Plain markdown, with no provider-specific syntax. */
export function renderPrompt(data: PromptData): string {
  const target = data.targetName
    ? `${data.to} (${data.targetName})`
    : data.to
  const out: string[] = []
  if (data.kind === 'translate')
    out.push(`# Translate ${data.items.length} messages from ${data.from} to ${target}`, '')
  else
    out.push(`# Review ${data.items.length} ${target} translations against ${data.from}`, '', 'Check meaning, placeholders, glossary terms, tone and length. Report and fix wrong translations.', '')
  if (data.items.length === 0) {
    return `${out.join('\n')}Nothing to do: every key is ${data.kind === 'translate'
      ? 'translated'
      : 'reviewed'}.\n`
  }
  out.push('## Rules', '', ...data.rules.map(rule => `- ${rule}`), ...data.notes.map(note => `- ${note}`), '')
  if (data.glossary.length > 0) {
    out.push('## Glossary', '')
    for (const entry of data.glossary) {
      out.push(`- ${entry.term}${entry.doNotTranslate
        ? ': do not translate'
        : entry.translation
          ? ` → ${entry.translation}`
          : ''}${entry.note
        ? ` (${entry.note})`
        : ''}`)
    }
    out.push('')
  }
  if (data.examples.length > 0) {
    out.push(`## Existing ${data.to} messages (style reference)`, '')
    for (const example of data.examples)
      out.push(`- \`${example.key}\`: ${JSON.stringify(example.source)} → ${JSON.stringify(example.target)}`)
    out.push('')
  }
  out.push('## Messages', '', ...data.items.flatMap(item => renderItem(item, data.to)))
  out.push('## How to write results', '', ...data.instructions.map(line => `- ${line}`), '')
  if (data.remaining > 0)
    out.push(`This prompt holds ${data.items.length} of ${data.total} messages.`, '')
  return out.join('\n')
}
