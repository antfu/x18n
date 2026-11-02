import type { LoadedProject } from '@x18n/node'
import type { GlobalOptions } from '../context'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openWorkspace, out, printJson } from '../context'

export interface TypegenOptions extends GlobalOptions {
  readonly watch?: boolean | undefined
}

interface Written {
  readonly project: string
  readonly path?: string | undefined
  readonly target?: string | undefined
  readonly changed: boolean
  readonly notice?: string | undefined
}

async function write(loaded: LoadedProject): Promise<Written> {
  const { project, root, name } = loaded
  if (!project.config.typegen)
    return { project: name, changed: false, notice: 'Typegen is off. Set `typegen: true` in the config.' }
  const file = project.typegen()
  if (!file)
    return { project: name, changed: false, notice: 'Nothing to generate. Typegen needs a tsconfig.json or typescript, and a preset with a typegen target.' }
  const before = await loaded.host.readFile(file.path)
  if (before === file.content) {
    return {
      project: name,
      path: file.path,
      target: file.target,
      changed: false,
    }
  }
  await writeFile(join(root, file.path), file.content)
  await project.update([
    {
      type: before === undefined
        ? 'create'
        : 'change',
      path: file.path,
    },
  ])
  return {
    project: name,
    path: file.path,
    target: file.target,
    changed: true,
  }
}

function show(result: Written): void {
  if (result.notice) {
    out(`${result.project}: ${result.notice}`)
  }
  else {
    out(result.changed
      ? `Wrote ${result.path} (${result.target}).`
      : `${result.path} is up to date.`)
  }
}

function watchTypes(projects: readonly LoadedProject[]): Promise<never> {
  for (const loaded of projects) {
    loaded.project.watch()
    loaded.project.onChange(() => void write(loaded).then((result) => {
      if (result.changed)
        show(result)
    }))
  }
  out('\nWatching for file changes.')
  return new Promise(() => {})
}

/** Writes the key types of each project. */
export async function typegen(options: TypegenOptions): Promise<number> {
  const workspace = await openWorkspace(options)
  const results = await Promise.all(workspace.projects.map(write))
  if (options.json)
    printJson('typegen', { projects: results })
  else
    results.forEach(show)
  return options.watch
    ? watchTypes(workspace.projects)
    : 0
}
