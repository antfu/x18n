import type { GlobalOptions } from '../context'
import { readdir, readFile } from 'node:fs/promises'
import { errors, renderPrompt } from '@x18n/core'
import { openWorkspace, out, printJson, singleProject } from '../context'

export interface PromptCommandOptions extends GlobalOptions {
  readonly to?: string | undefined
  readonly locale?: string | undefined
  readonly keys?: string | undefined
  readonly namespace?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  readonly format?: string | undefined
  readonly context?: boolean | undefined
  readonly stale?: boolean | undefined
  /** `true` for a bare `--check`, else the comma separated check ids. */
  readonly check?: boolean | string | undefined
}

/** The skill each skill prompt prints. */
const skillPrompts: Record<string, string> = {
  setup: 'x18n-setup',
  check: 'x18n-check',
}

// The skills are copied next to `dist/` when the package builds (see tsdown.config.ts).
const skillsDir = new URL('../skills/', import.meta.url)

/** A skill as one markdown document: its body without the front matter, then its references. */
async function readSkill(name: string): Promise<string> {
  const dir = new URL(`${name}/`, skillsDir)
  const skill = await readFile(new URL('SKILL.md', dir), 'utf8')
  const parts = [
    skill.replace(/^---\n[\s\S]*?\n---\n+/, '').trim(),
  ]
  const references = await readdir(new URL('references/', dir)).catch(() => [])
  for (const file of references.filter(file => file.endsWith('.md')).sort()) {
    const text = await readFile(new URL(`references/${file}`, dir), 'utf8')
    parts.push(`<!-- references/${file} -->\n\n${text.trim()}`)
  }
  return parts.join('\n\n---\n\n')
}

export async function prompt(kind: string, options: PromptCommandOptions): Promise<void> {
  const skill = skillPrompts[kind]
  if (skill) {
    out(await readSkill(skill))
    return
  }
  if (kind !== 'translate' && kind !== 'review')
    throw errors.X18N0001({ issue: `unknown prompt "${kind}" (translate, review, setup, check)` })
  const locale = kind === 'translate'
    ? options.to
    : options.locale ?? options.to
  if (!locale) {
    throw errors.X18N0001({
      issue: kind === 'translate'
        ? 'pass --to <locale>'
        : 'pass --locale <locale>',
    })
  }
  const check = typeof options.check === 'string'
    ? options.check.split(',').map(id => id.trim()).filter(Boolean)
    : options.check
  const { project, host } = singleProject(await openWorkspace(options))
  // `stale-translation` reports only with history.
  if (options.stale || check === true || (Array.isArray(check) && check.includes('stale-translation'))) {
    await project.loadHistory()
    await host.flush()
  }
  const data = project.prompt(kind, locale, {
    keys: options.keys,
    namespace: options.namespace,
    limit: options.limit === undefined
      ? undefined
      : Number(options.limit),
    cursor: options.cursor,
    context: options.context,
    stale: options.stale,
    check,
  })
  if (options.json || options.format === 'json')
    printJson(`prompt ${kind}`, data)
  else
    out(renderPrompt(data))
}
