import type { EditOp, JsonValue, KeyString, Project } from '@x18n/core'
import type { GlobalOptions } from '../context'
import { errors, joinKey, keyMatcher, parseMessageBatch, placeholderProblems, splitKey, toErrorInfo } from '@x18n/core'
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

interface FillOptions extends WriteOptions {
  readonly locale?: string | readonly string[] | undefined
  readonly copySource?: boolean | undefined
  readonly fromUsages?: boolean | undefined
}

/**
 * The keys of the `missing-key` diagnostics: keys code uses that the source locale lacks, minus `ignoreKeys`. Each is a
 * `set` op on the source locale with a default value written in code, or `''`. A key that would replace a message in any
 * locale (`a.b` under the message `a`), or that another added key would replace (`a` and `a.b`), is left out with a warning.
 */
function fromUsagesOps(p: Project): { readonly ops: EditOp[], readonly warnings: string[] } {
  const separator = p.config.keySeparator
  const ignored = keyMatcher(p.config.ignoreKeys, separator)
  const values = new Map<KeyString, string | undefined>()
  for (const usage of p.analyze().undefinedUsages) {
    const key = usage.key!
    if (!ignored(key) && values.get(key) === undefined)
      values.set(key, usage.defaultValue)
  }
  const parentsOf = (key: KeyString): KeyString[] => {
    const { namespace, path } = splitKey(key, p.namespaced, separator)
    return path.slice(0, -1).map((_, i) => joinKey(namespace, path.slice(0, i + 1), separator))
  }
  // Every key some other added key would sit under, with that key.
  const under = new Map<KeyString, KeyString>()
  for (const key of values.keys()) {
    for (const parent of parentsOf(key))
      under.set(parent, key)
  }
  const ops: EditOp[] = []
  const warnings: string[] = []
  for (const [key, value] of values) {
    const parents = parentsOf(key)
    let message: { parent: KeyString, locale: string } | undefined
    for (const parent of parents) {
      const locale = p.locales.find(l => p.message(parent, l) !== undefined)
      if (locale !== undefined) {
        message = { parent, locale }
        break
      }
    }
    const clash = parents.find(parent => values.has(parent)) ?? under.get(key)
    if (message !== undefined) {
      warnings.push(`"${key}" is not added: "${message.parent}" is a message in ${message.locale}, and adding "${key}" would replace it.`)
    }
    else if (clash !== undefined) {
      warnings.push(`"${key}" is not added: code also uses "${clash}", and one would replace the other.`)
    }
    else {
      ops.push({
        type: 'set',
        key,
        locale: p.sourceLocale,
        value: value ?? '',
      })
    }
  }
  return { ops, warnings }
}

export async function fill(options: FillOptions): Promise<void> {
  if (options.fromUsages) {
    if (options.locale !== undefined)
      throw errors.X18N4008({ reason: '--from-usages fills the source locale; leave out --locale' })
    if (options.copySource)
      throw errors.X18N4008({ reason: '--from-usages has no source value to copy; leave out --copy-source' })
    const loaded = await project(options)
    const { ops, warnings } = fromUsagesOps(loaded.project)
    const plan = loaded.project.plan(ops)
    await runPlan('fill', loaded, {
      ...plan,
      warnings: [
        ...plan.warnings,
        ...warnings,
      ],
    }, options)
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

/** `delete --unused [glob]`: every unused key that no dynamic usage may reach, in all locales. */
async function removeUnused(glob: string | undefined, options: DeleteOptions): Promise<void> {
  if (options.locale !== undefined)
    throw errors.X18N4008({ reason: '--unused deletes in every locale; leave out --locale' })
  const loaded = await project(options)
  const deletion = loaded.project.planUnused({ glob, namespace: options.namespace })
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
  const files = new Set(deleted.flatMap(k => k.messages.map(m => m.file)))
  await runPlan('delete', loaded, deletion.plan, options, {
    data: { deleted, kept },
    text: (applied) => {
      const lines = [
        ...deleted.map(k => `delete ${k.key}  ${k.messages.map(m => `${m.locale} ${m.file}`).join(', ')}`),
        ...kept.map(k => `keep ${k.key}  may be used by ${k.usages.map(u => `${u.file}:${u.line}:${u.column}`).join(', ')}`),
        ...deletion.plan.warnings.map(w => `warning: ${w}`),
      ]
      const count = `${deleted.length} unused key${deleted.length === 1
        ? ''
        : 's'} in ${files.size} file${files.size === 1
        ? ''
        : 's'}`
      lines.push(deleted.length === 0
        ? 'No unused keys to delete.'
        : applied
          ? `Deleted ${count}.`
          : `Would delete ${count} (dry run).`)
      return lines.join('\n')
    },
  })
}
