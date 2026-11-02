import type { KeyString, LocaleCoverage } from '@x18n/core'
import type { LoadedProject } from '@x18n/node'
import type { GlobalOptions } from '../context'
import { renderExplanation } from '@x18n/core'
import { displayPath, locate, openWorkspace, out, printJson, wireDiagnostics } from '../context'

function percent(coverage: LocaleCoverage): number {
  return coverage.total === 0
    ? 100
    : Math.floor((coverage.translated / coverage.total) * 1000) / 10
}

function summaryOf(loaded: LoadedProject): { errors: number, warnings: number, infos: number } {
  const diagnostics = loaded.project.analyze().diagnostics
  return {
    errors: diagnostics.filter(d => d.severity === 'error').length,
    warnings: diagnostics.filter(d => d.severity === 'warning').length,
    infos: diagnostics.filter(d => d.severity === 'info' || d.severity === 'hint').length,
  }
}

function statusData(loaded: LoadedProject): object {
  const { project } = loaded
  return {
    name: loaded.name,
    root: displayPath(loaded.root, ''),
    sourceLocale: project.sourceLocale,
    locales: project.analyze().coverage.map(c => ({
      locale: c.locale,
      total: c.total,
      translated: c.translated,
      missing: c.missing.length,
      empty: c.empty.length,
      percent: percent(c),
    })),
    resources: project.resources.length,
    keys: project.keys().length,
    usages: project.usages().length,
    summary: summaryOf(loaded),
  }
}

export async function status(options: GlobalOptions): Promise<void> {
  const workspace = await openWorkspace(options)
  if (options.json) {
    printJson('status', {
      projects: workspace.projects.map(statusData),
    })
    return
  }
  for (const loaded of workspace.projects) {
    const { project } = loaded
    const summary = summaryOf(loaded)
    out(`${loaded.name} (${displayPath(loaded.root, '')})`)
    out(`  ${project.resources.length} resources, ${project.keys().length} keys, ${project.usages().length} usages`)
    for (const c of project.analyze().coverage) {
      const label = `${c.locale}${c.locale === project.sourceLocale
        ? ' (source)'
        : ''}`
      out(`  ${label.padEnd(16)} ${String(percent(c)).padStart(5)}%  ${c.translated}/${c.total}${c.missing.length
        ? `, ${c.missing.length} missing`
        : ''}${c.empty.length
        ? `, ${c.empty.length} empty`
        : ''}`)
    }
    out(`  ${summary.errors} errors, ${summary.warnings} warnings`)
  }
}

export interface KeysOptions extends GlobalOptions {
  readonly missing?: string | undefined
  readonly unused?: boolean | undefined
  readonly namespace?: string | undefined
  readonly values?: boolean | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

/** One page of a list: `--limit` items from `--cursor`, plus the cursor of the next page. */
function page<T>(items: readonly T[], options: { readonly limit?: number | undefined, readonly cursor?: string | undefined }): { items: T[], total: number, nextCursor: string | undefined } {
  const start = Number(options.cursor ?? 0) || 0
  const end = options.limit
    ? start + Number(options.limit)
    : items.length
  return {
    items: items.slice(start, end),
    total: items.length,
    nextCursor: end < items.length
      ? String(end)
      : undefined,
  }
}

export async function keys(glob: string | undefined, options: KeysOptions): Promise<void> {
  const workspace = await openWorkspace(options)
  const projects = workspace.projects.map((loaded) => {
    const { project } = loaded
    const list = project.keys({
      glob,
      missing: options.missing,
      unused: options.unused,
      namespace: options.namespace,
    })
    const { items, total, nextCursor } = page(list, options)
    const values = (key: KeyString): Record<string, unknown> => Object.fromEntries(project.locales.map(locale => [locale, project.message(key, locale)?.value]))
    return {
      name: loaded.name,
      total,
      nextCursor,
      keys: items.map(key => options.values
        ? {
            key,
            values: values(key),
          }
        : { key }),
    }
  })
  if (options.json) {
    printJson('keys', { projects })
    return
  }
  for (const p of projects) {
    if (workspace.projects.length > 1)
      out(`# ${p.name}`)
    for (const item of p.keys) {
      out('values' in item
        ? `${item.key}\t${JSON.stringify(item.values)}`
        : item.key)
    }
    if (p.nextCursor)
      out(`… ${p.total - Number(p.nextCursor)} more (--cursor ${p.nextCursor})`)
  }
}

export async function search(query: string, options: GlobalOptions & { readonly exact?: boolean | undefined, readonly limit?: number | undefined, readonly cursor?: string | undefined }): Promise<void> {
  const workspace = await openWorkspace(options)
  const projects = workspace.projects.map((loaded) => {
    const { project } = loaded
    const { items, total, nextCursor } = page(project.search(String(query), { exact: options.exact }), options)
    return {
      name: loaded.name,
      total,
      nextCursor,
      matches: items.map(m => ({
        key: m.key,
        locale: m.locale,
        value: m.value,
        usages: project.usages({ key: m.key }).map(u => ({
          possible: u.possible,
          ...locate(loaded, u.usage.path, u.usage.range.start, u.usage.range.end),
        })),
      })),
    }
  })
  if (options.json) {
    printJson('search', { projects })
    return
  }
  for (const p of projects) {
    if (workspace.projects.length > 1)
      out(`# ${p.name}`)
    for (const m of p.matches) {
      out(`${m.key}  ${m.locale}  ${JSON.stringify(m.value)}`)
      for (const u of m.usages)
        out(`  ${u.file}:${u.line}:${u.column}${u.possible ? ' (possible)' : ''}`)
    }
    if (p.nextCursor)
      out(`… ${p.total - Number(p.nextCursor)} more (--cursor ${p.nextCursor})`)
  }
}

export async function get(input: string, options: GlobalOptions): Promise<void> {
  const workspace = await openWorkspace(options)
  const projects = workspace.projects.flatMap((loaded) => {
    const { project } = loaded
    const info = project.get(project.parseKey(input))
    if (!info)
      return []
    const resourceOf = (id: string): string => project.resources.find(r => r.id === id)?.path ?? id
    return [
      {
        name: loaded.name,
        key: info.key,
        namespace: info.namespace,
        messages: info.messages.map(m => ({
          locale: m.locale,
          value: m.value,
          ...locate(loaded, resourceOf(m.resource), m.range?.key.start ?? 0, m.range?.key.end ?? 0),
        })),
        missing: info.missing,
        usages: info.usages.map(u => ({
          possible: u.possible,
          raw: u.usage.raw,
          ...locate(loaded, u.usage.path, u.usage.range.start, u.usage.range.end),
        })),
        diagnostics: wireDiagnostics(loaded, info.diagnostics),
        reviews: info.reviews,
      },
    ]
  })
  if (options.json) {
    printJson('get', { projects })
    return
  }
  if (projects.length === 0)
    out(`"${input}" is not defined.`)
  for (const p of projects) {
    out(`${p.key}${workspace.projects.length > 1
      ? ` (${p.name})`
      : ''}`)
    for (const m of p.messages)
      out(`  ${m.locale.padEnd(8)} ${JSON.stringify(m.value)}  ${m.file}:${m.line}:${m.column}`)
    if (p.missing.length)
      out(`  missing in ${p.missing.join(', ')}`)
    out(`  ${p.usages.length} usages`)
    for (const u of p.usages)
      out(`    ${u.file}:${u.line}:${u.column}${u.possible ? ' (possible)' : ''}`)
    for (const d of p.diagnostics)
      out(`  ${d.severity} ${d.code}: ${d.message}`)
    for (const thread of p.reviews) {
      out(`  review ${thread.locale}: ${thread.state ?? 'resolved'}, ${thread.comments.length} comment${thread.comments.length === 1
        ? ''
        : 's'}`)
    }
  }
}

export async function usages(input: string | undefined, options: GlobalOptions & { readonly file?: string | undefined, readonly limit?: number | undefined, readonly cursor?: string | undefined }): Promise<void> {
  const workspace = await openWorkspace(options)
  const projects = workspace.projects.map((loaded) => {
    const { project } = loaded
    const matches = project.usages({
      key: input === undefined
        ? undefined
        : project.parseKey(input),
      path: options.file,
    })
    const { items, total, nextCursor } = page(matches, options)
    return {
      name: loaded.name,
      total,
      nextCursor,
      usages: items.map(m => ({
        key: m.usage.key,
        raw: m.usage.raw,
        possible: m.possible,
        dynamic: m.usage.dynamic,
        ...locate(loaded, m.usage.path, m.usage.range.start, m.usage.range.end),
      })),
    }
  })
  if (options.json) {
    printJson('usages', { projects })
    return
  }
  for (const p of projects) {
    for (const u of p.usages)
      out(`${u.file}:${u.line}:${u.column}\t${u.key ?? u.raw}${u.possible ? ' (possible)' : ''}`)
  }
}

export async function locales(options: GlobalOptions): Promise<void> {
  const workspace = await openWorkspace(options)
  const projects = workspace.projects.map(loaded => ({
    name: loaded.name,
    sourceLocale: loaded.project.sourceLocale,
    locales: loaded.project.locales.map(code => ({
      ...loaded.project.localeInfo(code),
      resources: loaded.project.resources.filter(r => r.locale === code).map(r => displayPath(loaded.root, r.path)),
    })),
  }))
  if (options.json) {
    printJson('locales', { projects })
    return
  }
  for (const p of projects) {
    for (const l of p.locales)
      out(`${l.code.padEnd(10)} ${(l.displayName ?? '').padEnd(28)} ${l.resources.join(', ')}`)
  }
}

export async function doctor(options: GlobalOptions): Promise<void> {
  const workspace = await openWorkspace(options)
  const projects = workspace.projects.map(loaded => ({
    ...loaded.project.explain(),
    root: displayPath(loaded.root, ''),
    configFile: loaded.configFile && displayPath(loaded.configFile, ''),
  }))
  if (options.json) {
    printJson('doctor', { projects })
    return
  }
  for (const e of projects)
    out(renderExplanation(e, e.configFile))
}
