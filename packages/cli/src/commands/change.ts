import type { EditOp, JsonValue, KeyString, Project, UnusedDeletion } from '@x18n/core'
import type { LoadedProject } from '@x18n/node'
import type { GlobalOptions } from '../context'
import { errors, keyMatcher, parseMessageBatch, placeholderProblems, toErrorInfo } from '@x18n/core'
import { displayPath, locate, openWorkspace, out, printJson, readInput, runPlan, singleProject, stdinArg } from '../context'

interface WriteOptions extends GlobalOptions {
  readonly dryRun?: boolean | undefined
}

async function project(options: GlobalOptions): Promise<ReturnType<typeof singleProject>> {
  return singleProject(await openWorkspace(options))
}

export async function set(key: string, options: WriteOptions & { readonly locale?: string | undefined, readonly value?: string | undefined }): Promise<void> {
  if (options.value === undefined)
    throw errors.X18N4008({ reason: 'pass --value <text> (or --value - to read stdin)' })
  const loaded = await project(options)
  const value = options.value === stdinArg
    ? (await readInput(stdinArg)).replace(/\r?\n$/, '')
    : String(options.value)
  const locale = options.locale ?? loaded.project.sourceLocale
  await runPlan('set', loaded, loaded.project.plan([
    {
      type: 'set',
      key: loaded.project.parseKey(key),
      locale,
      value,
    },
  ]), options)
}

export async function apply(source: string, options: WriteOptions & { readonly force?: boolean | undefined }): Promise<number> {
  const loaded = await project(options)
  const p = loaded.project
  let data: JsonValue
  try {
    data = JSON.parse(await readInput(source))
  }
  catch (error) {
    throw errors.X18N4008({ reason: `${source} is not JSON: ${error instanceof Error
      ? error.message
      : String(error)}`, cause: error })
  }
  const ops = parseMessageBatch(p, data)
  const rejected = placeholderProblems(p, ops)
  if (rejected.length > 0 && !options.force) {
    if (options.json) {
      printJson('apply', { applied: false, rejected }, [], [
        toErrorInfo(errors.X18N4007({ count: rejected.length })),
      ])
      return 1
    }
    for (const r of rejected) {
      out(`rejected ${r.locale} ${r.key}: ${[
        r.missing.length
          ? `missing ${r.missing.join(', ')}`
          : '',
        r.extra.length
          ? `unexpected ${r.extra.join(', ')}`
          : '',
      ].filter(Boolean).join('; ')}`)
    }
    out(`${rejected.length} values have placeholder problems; nothing was written. Fix them or pass --force.`)
    return 1
  }
  await runPlan('apply', loaded, p.plan(ops), options)
  return 0
}

export async function rename(from: string, to: string, options: WriteOptions & { readonly usages?: boolean | undefined }): Promise<void> {
  const loaded = await project(options)
  const p = loaded.project
  const op: EditOp = {
    type: 'rename',
    from: p.parseKey(from),
    to: p.parseKey(to),
    usages: options.usages !== false,
  }
  await runPlan('rename', loaded, p.plan([op]), options)
}

interface DeleteOptions extends WriteOptions {
  readonly locale?: string | readonly string[] | undefined
  readonly unused?: boolean | undefined
  readonly namespace?: string | undefined
}

export async function remove(key: string | undefined, options: DeleteOptions): Promise<void> {
  if (options.unused) {
    await removeUnused(key, options)
    return
  }
  if (key === undefined)
    throw errors.X18N4008({ reason: 'pass a key, or --unused to delete every unused key' })
  const loaded = await project(options)
  const locales = options.locale === undefined
    ? 'all'
    : [options.locale].flat()
  await runPlan('delete', loaded, loaded.project.plan([
    {
      type: 'delete',
      key: loaded.project.parseKey(key),
      locales,
    },
  ]), options)
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1
    ? ''
    : 's'}`
}

interface FillOptions extends WriteOptions {
  readonly locale?: string | readonly string[] | undefined
  readonly copySource?: boolean | undefined
  readonly fromUsages?: boolean | undefined
}

/** The keys of the `missing-key` diagnostics, minus `ignoreKeys`, as `set` ops that replace nothing; a usage with a default value wins. */
function fromUsagesOps(p: Project): Extract<EditOp, { type: 'set' }>[] {
  const ignored = keyMatcher(p.config.ignoreKeys, p.config.keySeparator)
  const values = new Map<KeyString, string | undefined>()
  for (const usage of p.analyze().undefinedUsages) {
    if (!ignored(usage.key!) && values.get(usage.key!) === undefined)
      values.set(usage.key!, usage.defaultValue)
  }
  return [...values].map(([key, value]) => ({
    type: 'set',
    key,
    locale: p.sourceLocale,
    value: value ?? '',
    replace: false,
  }))
}

export async function fill(options: FillOptions): Promise<void> {
  if (options.fromUsages) {
    if (options.locale !== undefined)
      throw errors.X18N4008({ reason: '--from-usages fills the source locale; leave out --locale' })
    if (options.copySource)
      throw errors.X18N4008({ reason: '--from-usages has no source value to copy; leave out --copy-source' })
    const loaded = await project(options)
    await runPlan('fill', loaded, loaded.project.plan(fromUsagesOps(loaded.project)), options)
    return
  }
  const loaded = await project(options)
  const p = loaded.project
  const targets = options.locale === undefined
    ? p.locales.filter(l => l !== p.sourceLocale)
    : [options.locale].flat()
  const ops: EditOp[] = []
  for (const locale of targets) {
    for (const key of p.keys({ missing: locale })) {
      if (p.message(key, locale) !== undefined)
        continue
      ops.push({
        type: 'set',
        key,
        locale,
        value: options.copySource
          ? p.message(key, p.sourceLocale)?.value ?? ''
          : '',
      })
    }
  }
  await runPlan('fill', loaded, p.plan(ops), options)
}

export async function format(options: WriteOptions): Promise<void> {
  const loaded = await project(options)
  await runPlan('format', loaded, loaded.project.plan([
    { type: 'format' },
  ]), options)
}

/** The deleted and kept keys of an unused deletion, for `--json`, and one text line per key. */
function unusedReport(loaded: LoadedProject, deletion: UnusedDeletion): { deleted: object[], kept: object[], files: number, lines: string[] } {
  const deleted = deletion.keys.map(k => ({
    key: k.key,
    messages: k.messages.map(m => ({
      locale: m.locale,
      file: displayPath(loaded.root, m.path),
    })),
  }))
  const kept = deletion.kept.map(k => ({
    key: k.key,
    usages: k.usages.map(u => ({
      raw: u.raw,
      ...locate(loaded, u.path, u.range.start, u.range.end),
    })),
  }))
  return {
    deleted,
    kept,
    files: new Set(deleted.flatMap(k => k.messages.map(m => m.file))).size,
    lines: [
      ...deleted.map(k => `delete ${k.key}  ${k.messages.map(m => `${m.locale} ${m.file}`).join(', ')}`),
      ...kept.map(k => `keep ${k.key}  may be used by ${k.usages.map(u => `${u.file}:${u.line}:${u.column}`).join(', ')}`),
    ],
  }
}

/** `delete --unused [glob]`: every unused key that no dynamic usage may reach, in all locales. */
async function removeUnused(glob: string | undefined, options: DeleteOptions): Promise<void> {
  if (options.locale !== undefined)
    throw errors.X18N4008({ reason: '--unused deletes in every locale; leave out --locale' })
  const loaded = await project(options)
  const deletion = loaded.project.planUnused({ glob, namespace: options.namespace })
  const report = unusedReport(loaded, deletion)
  await runPlan('delete', loaded, deletion.plan, options, {
    data: { deleted: report.deleted, kept: report.kept },
    text: (applied) => {
      const lines = [
        ...report.lines,
        ...deletion.plan.warnings.map(w => `warning: ${w}`),
      ]
      const keys = `${count(report.deleted.length, 'unused key')} in ${count(report.files, 'file')}`
      lines.push(report.deleted.length === 0
        ? 'No unused keys to delete.'
        : applied
          ? `Deleted ${keys}.`
          : `Would delete ${keys} (dry run).`)
      return lines.join('\n')
    },
  })
}

/**
 * `sync`: one plan that adds the keys `fill --from-usages` adds, deletes the keys `delete --unused` deletes, and
 * formats every resource, so the resources match the code after one load, one scan and one write per file.
 */
export async function sync(options: WriteOptions): Promise<void> {
  const loaded = await project(options)
  const p = loaded.project
  const sets = fromUsagesOps(p)
  const deletion = p.planUnused({}, [
    ...sets,
    { type: 'format' },
  ])
  const { plan } = deletion
  const report = unusedReport(loaded, deletion)
  // A set the planner skipped (it would replace a message) is not added.
  const planned = new Set(plan.keys)
  const added = sets.filter(op => planned.has(op.key)).map(op => ({ key: op.key, locale: op.locale, value: op.value }))
  await runPlan('sync', loaded, plan, options, {
    data: { added, deleted: report.deleted, kept: report.kept },
    text: (applied) => {
      const lines = [
        ...added.map(a => `add ${a.key}  ${a.locale}`),
        ...report.lines,
        ...plan.changes.map(change => `${change.type} ${displayPath(loaded.root, change.path)}`),
        ...plan.warnings.map(w => `warning: ${w}`),
      ]
      const summary = (): string => {
        const files = plan.changes.length
        if (files === 0 && plan.warnings.length === 0)
          return 'The resources match the code.'
        if (files === 0)
          return 'No changes.'
        const deleted = count(report.deleted.length, 'unused key')
        if (applied)
          return `Added ${count(added.length, 'key')} and deleted ${deleted}; wrote ${count(files, 'file')}.`
        return `Would add ${count(added.length, 'key')} and delete ${deleted}; ${count(files, 'file')} would change (dry run).`
      }
      lines.push(summary())
      return lines.join('\n')
    },
  })
}
