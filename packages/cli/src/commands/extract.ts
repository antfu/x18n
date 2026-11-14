import type { ExtractSelection } from '@x18n/builtins/extractors'
import type { GlobalOptions } from '../context'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { extractItems, findCandidates, findSelections, renderSelections, toPlanFile } from '@x18n/builtins/extractors'
import { errors, isJsonObject } from '@x18n/core'
import { displayPath, openWorkspace, out, printJson, runPlan, singleProject } from '../context'

export interface ExtractCommandOptions extends GlobalOptions {
  readonly list?: boolean | undefined
  readonly plan?: string | undefined
  readonly apply?: string | undefined
  readonly dryRun?: boolean | undefined
}

type PlanItem = Parameters<typeof extractItems>[1][number]

function isPlanItem(value: unknown): value is PlanItem {
  if (!isJsonObject(value) || !isJsonObject(value.range))
    return false
  const strings = [
    'path',
    'original',
    'key',
    'value',
    'replacement',
  ].every(field => typeof value[field] === 'string')
  return strings && typeof value.range.start === 'number' && typeof value.range.end === 'number' && Array.isArray(value.imports) && value.imports.every(line => typeof line === 'string')
}

async function readPlan(file: string): Promise<PlanItem[]> {
  const data: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!isJsonObject(data) || !Array.isArray(data.items) || !data.items.every(isPlanItem))
    throw errors.X18N4008({ reason: `${file} is not an extraction plan` })
  return data.items
}

/** One question per string in a TTY: extract with the proposed key, a typed key, or skip. */
async function review(candidates: readonly ExtractSelection[], root: string): Promise<ExtractSelection[]> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const picked: ExtractSelection[] = []
  try {
    for (const candidate of candidates) {
      process.stderr.write(`\n${displayPath(root, candidate.path)}:${candidate.line}  ${JSON.stringify(candidate.text)}\n  → ${candidate.replacement}\n`)
      const reply = (await rl.question(`Extract as "${candidate.key}"? [Y/n/key/q] `)).trim()
      if (reply === 'q')
        break
      if (reply === 'n')
        continue
      picked.push(reply && reply !== 'y'
        ? {
            ...candidate,
            key: reply,
          }
        : candidate)
    }
  }
  finally {
    rl.close()
  }
  return picked
}

export async function extract(files: readonly string[], options: ExtractCommandOptions): Promise<void> {
  const loaded = singleProject(await openWorkspace(options))
  const { project } = loaded
  if (options.apply) {
    const items = extractItems(project, await readPlan(options.apply))
    await runPlan('extract', loaded, project.plan([
      { type: 'extract', items },
    ]), options)
    return
  }
  const interactive = !options.plan && !options.list && !options.yes && !options.json && process.stdin.isTTY
  if (interactive) {
    const selected = await review(findSelections(project, { files }), loaded.root)
    if (selected.length === 0) {
      out('Nothing to extract.')
      return
    }
    await runPlan('extract', loaded, project.plan([
      {
        type: 'extract',
        items: renderSelections(project, selected),
      },
    ]), options)
    return
  }
  const candidates = findCandidates(project, { files })
  if (options.plan) {
    await writeFile(options.plan, `${JSON.stringify(toPlanFile(project, candidates), null, 2)}\n`)
    if (options.json)
      printJson('extract', { plan: options.plan, items: candidates.length })
    else
      out(`Wrote ${candidates.length} strings to ${options.plan}. Edit keys and replacements, then run \`x18n extract --apply ${options.plan}\`.`)
    return
  }
  if (options.list || !options.yes) {
    if (options.json) {
      printJson('extract', {
        items: candidates.map(c => ({
          ...c,
          file: displayPath(loaded.root, c.path),
        })),
      })
      return
    }
    for (const c of candidates)
      out(`${displayPath(loaded.root, c.path)}:${c.line}\t${c.kind}\t${JSON.stringify(c.text)}\t→ ${c.key}${c.reused ? ' (existing)' : ''}`)
    out(`${candidates.length} strings. Apply with \`x18n extract --yes\`, or review with \`x18n extract --plan plan.json\`.`)
    return
  }
  const chosen = candidates
  if (chosen.length === 0) {
    out('Nothing to extract.')
    return
  }
  await runPlan('extract', loaded, project.plan([
    {
      type: 'extract',
      items: extractItems(project, chosen),
    },
  ]), options)
}
