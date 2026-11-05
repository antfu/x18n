import type { CacheStore, Disposable, FileEvent, Host, Logger, ReviewAuthor } from '@x18n/core'
import type { Ignore } from 'ignore'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { hashText } from '@x18n/core'
import { watch as chokidar } from 'chokidar'
import ignore from 'ignore'
import { glob } from 'tinyglobby'
import { executeFile } from './config'

export interface NodeHostOptions {
  /** Directory of the persistent cache, or false to disable it. Default `node_modules/.cache/x18n` under the root. */
  readonly cacheDir?: string | false | undefined
  readonly logger?: Logger | undefined
}

export interface NodeHost extends Host {
  /** Writes the persistent cache to disk. */
  readonly flush: () => Promise<void>
}

function toPosix(path: string): string {
  return sep === '\\'
    ? path.replace(/\\/g, '/')
    : path
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'EISDIR')
}

export const stderrLogger: Logger = {
  info: message => process.stderr.write(`${message}\n`),
  warn: message => process.stderr.write(`warning: ${message}\n`),
  error: message => process.stderr.write(`error: ${message}\n`),
}

/** The directory holding `.git`, at or above `start`. */
export function findGitRoot(start: string): string | undefined {
  let dir = resolve(start)
  while (true) {
    if (existsSync(join(dir, '.git')))
      return dir
    const parent = dirname(dir)
    if (parent === dir)
      return undefined
    dir = parent
  }
}

/** Every `.gitignore` that applies under `root`: the ones above it up to the git root, and nested ones. */
async function loadGitignore(root: string): Promise<(path: string) => boolean> {
  const rules: { base: string, ig: Ignore }[] = []
  const gitRoot = findGitRoot(root) ?? root
  const add = async (dir: string): Promise<void> => {
    const text = await readFile(join(dir, '.gitignore'), 'utf8').catch(() => undefined)
    if (text !== undefined) {
      rules.push({
        base: dir,
        ig: ignore().add(text),
      })
    }
  }
  let dir = root
  const chain: string[] = []
  while (dir.startsWith(gitRoot)) {
    chain.push(dir)
    if (dir === gitRoot)
      break
    dir = dirname(dir)
  }
  for (const item of chain.reverse())
    await add(item)
  const nested = await glob(['**/.gitignore'], {
    cwd: root,
    ignore: ['**/node_modules/**', '.gitignore'],
    dot: true,
  })
  for (const file of nested)
    await add(join(root, dirname(file)))
  return (path) => {
    const absolute = join(root, path)
    return rules.some(({ base, ig }) => {
      const rel = toPosix(relative(base, absolute))
      return rel !== '' && !rel.startsWith('..') && ig.ignores(rel)
    })
  }
}

function gitConfig(cwd: string, key: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['config', key], { cwd, encoding: 'utf8' }, (error, stdout) => {
      resolve(error
        ? undefined
        : stdout.trim() || undefined)
    })
  })
}

/** The git `user.name` and `user.email`, or undefined without git or a configured user. */
async function gitIdentity(cwd: string): Promise<ReviewAuthor | undefined> {
  const [name, email] = await Promise.all([
    gitConfig(cwd, 'user.name'),
    gitConfig(cwd, 'user.email'),
  ])
  return name === undefined && email === undefined
    ? undefined
    : {
        ...name !== undefined && { name },
        ...email !== undefined && { email },
      }
}

/** A persistent cache in one JSON file. Only entries used in this session are written back, so it stays bounded. */
function createFileCache(dir: string): CacheStore & { flush: () => Promise<void> } {
  const file = join(dir, 'cache.json')
  let entries: Promise<Map<string, string>> | undefined
  const used = new Map<string, string>()
  let dirty = false
  // One read for every concurrent `get`.
  const load = (): Promise<Map<string, string>> => {
    entries ??= readFile(file, 'utf8').then((text) => {
      const data: unknown = JSON.parse(text)
      return new Map(typeof data === 'object' && data !== null
        ? Object.entries(data).filter((e): e is [string, string] => typeof e[1] === 'string')
        : [])
    }).catch(() => new Map<string, string>())
    return entries
  }
  return {
    async get(key) {
      const value = (await load()).get(key)
      if (value !== undefined)
        used.set(key, value)
      return value
    },
    async set(key, value) {
      used.set(key, value)
      dirty = true
    },
    async flush() {
      if (!dirty)
        return
      await mkdir(dir, { recursive: true })
      await writeFile(file, JSON.stringify(Object.fromEntries(used)))
      dirty = false
    },
  }
}

export function createNodeHost(root: string, options: NodeHostOptions = {}): NodeHost {
  const absoluteRoot = resolve(root)
  let gitignore: Promise<(path: string) => boolean> | undefined
  const cacheDir = options.cacheDir === false
    ? undefined
    : options.cacheDir ?? join(absoluteRoot, 'node_modules/.cache/x18n')
  const cache = cacheDir
    ? createFileCache(join(cacheDir, hashText(absoluteRoot)))
    : undefined
  const full = (path: string): string => resolve(absoluteRoot, path)
  let identity: Promise<ReviewAuthor | undefined> | undefined

  return {
    root: absoluteRoot,
    logger: options.logger,
    cache,
    async readFile(path) {
      try {
        return await readFile(full(path), 'utf8')
      }
      catch (error) {
        if (isNotFound(error))
          return undefined
        throw error
      }
    },
    async writeFile(path, content) {
      const file = full(path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content, 'utf8')
    },
    async deleteFile(path) {
      await rm(full(path), { force: true })
    },
    executeModule: path => executeFile(full(path)),
    async glob(patterns, globOptions = {}) {
      const found = await glob([...patterns], {
        cwd: absoluteRoot,
        ignore: [
          ...globOptions.ignore ?? [],
        ],
        dot: false,
        followSymbolicLinks: false,
      })
      const paths = found.map(toPosix)
      if (!globOptions.gitignore)
        return paths.sort()
      gitignore ??= loadGitignore(absoluteRoot)
      const ignored = await gitignore
      return paths.filter(path => !ignored(path)).sort()
    },
    watch(_patterns, onChange): Disposable {
      let pending: FileEvent[] = []
      let timer: ReturnType<typeof setTimeout> | undefined
      const push = (type: FileEvent['type']) => (file: string): void => {
        const path = toPosix(relative(absoluteRoot, file))
        if (path.startsWith('..') || path.includes('node_modules/') || path.startsWith('.git/'))
          return
        pending.push({ type, path })
        clearTimeout(timer)
        timer = setTimeout(() => {
          const events = pending
          pending = []
          onChange(events)
        }, 50)
      }
      const watcher = chokidar(absoluteRoot, {
        ignoreInitial: true,
        ignored: (path: string) => /[/\\](?:node_modules|\.git)(?:[/\\]|$)/.test(path),
      })
      watcher.on('add', push('create')).on('change', push('change')).on('unlink', push('delete'))
      return {
        dispose: () => {
          clearTimeout(timer)
          void watcher.close()
        },
      }
    },
    identity: () => identity ??= gitIdentity(absoluteRoot),
    flush: async () => cache?.flush(),
  }
}
