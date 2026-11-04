import type { Disposable, HistoryContext, HistoryProvider, KeyString, LocaleCode, MessageChange, MessageHistory, MessageLeaf, Plugin, Resource } from '@x18n/core'
import type { FSWatcher } from 'chokidar'
import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'
import { hashText } from '@x18n/core'
import { watch as chokidar } from 'chokidar'
import { version } from '../package.json' with { type: 'json' }

export interface GitHistoryOptions {
  /** Most commits to read, newest first. Default: every commit. */
  readonly maxDepth?: number | undefined
  /** Only commits after this time: a `git log --since` value such as `1 year ago`, or a Date. */
  readonly since?: string | Date | undefined
}

declare module '@x18n/core' {
  interface HistoryConfigs {
    readonly git?: false | GitHistoryOptions
  }
}

/** One change of a message: committer time in ms, commit, author, and the value after it. */
type Change = readonly [at: number, revision: string, author: string, value: MessageLeaf]
type Changes = Map<KeyString, Map<LocaleCode, Change[]>>

/** The cached walk: changes per key and locale up to `head`, newest first. */
interface Walked {
  readonly head: string
  readonly changes: readonly (readonly [KeyString, readonly (readonly [LocaleCode, Change[]])[]])[]
}

interface FileChange {
  readonly resource: Resource
  readonly before: string | undefined
  readonly after: string | undefined
}

interface Commit {
  readonly at: number
  readonly author: string
  readonly files: FileChange[]
}

const noBlob = /^0+$/

function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotePath=false', ...args], { cwd, maxBuffer: 1024 ** 3, encoding: 'utf8' }, (error, stdout) => {
      if (error)
        reject(error)
      else
        resolve(stdout)
    })
  })
}

/** Blob texts by sha, through one `git cat-file --batch`. */
function readBlobs(cwd: string, shas: readonly string[]): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', () => {
      const data = Buffer.concat(chunks)
      const out = new Map<string, string>()
      let position = 0
      while (position < data.length) {
        const end = data.indexOf(10, position)
        const [sha, type, size] = data.subarray(position, end).toString('utf8').split(' ')
        position = end + 1
        if (type !== 'blob')
          continue
        out.set(sha!, data.subarray(position, position + Number(size)).toString('utf8'))
        position += Number(size) + 1
      }
      resolve(out)
    })
    child.stdin.end(shas.length
      ? `${shas.join('\n')}\n`
      : '')
  })
}

/** The path a file added in `commit` was renamed from, with its blob. */
async function renamedFrom(top: string, commit: string, path: string): Promise<{ path: string, blob: string } | undefined> {
  const out = await git(top, [
    'diff-tree',
    '-r',
    '-M',
    '--raw',
    '--no-abbrev',
    '--no-commit-id',
    commit,
  ])
  for (const line of out.split('\n')) {
    const [meta, from, to] = line.split('\t')
    if (to === path && meta?.split(' ')[4]?.startsWith('R'))
      return { path: from!, blob: meta.split(' ')[2]! }
  }
  return undefined
}

interface WalkInput {
  readonly ctx: HistoryContext
  readonly top: string
  readonly resources: ReadonlyMap<string, Resource>
  readonly head: string
  /** Commits reachable from here are already walked. */
  readonly base: string | undefined
  readonly window: readonly string[]
}

interface LogEntry {
  readonly sha: string
  readonly at: number
  readonly author: string
  readonly files: readonly { readonly path: string, readonly status: string, readonly before: string | undefined, readonly after: string | undefined }[]
}

/** Parses `git log --raw --format=%x01%H%x00%ct%x00%an`. */
function parseLog(out: string): LogEntry[] {
  return out.split('\u0001').slice(1).map((chunk) => {
    const [header = '', ...lines] = chunk.split('\n')
    const [sha = '', time, author = ''] = header.split('\0')
    const files = lines.filter(line => line.startsWith(':')).map((line) => {
      const [meta = '', ...paths] = line.split('\t')
      const [, , before = '', after = '', status = ''] = meta.split(' ')
      return {
        path: paths.at(-1) ?? '',
        status,
        before: noBlob.test(before)
          ? undefined
          : before,
        after: noBlob.test(after)
          ? undefined
          : after,
      }
    })
    return {
      sha,
      at: Number(time) * 1000,
      author,
      files,
    }
  })
}

async function collectCommits(input: WalkInput): Promise<Map<string, Commit>> {
  const commits = new Map<string, Commit>()
  const queue = [
    { from: input.head, paths: input.resources },
  ]
  for (let item = queue.shift(); item; item = queue.shift()) {
    const out = await git(input.top, [
      'log',
      item.from,
      ...input.base
        ? [`^${input.base}`]
        : [],
      '--no-merges',
      '--raw',
      '--no-abbrev',
      '--format=%x01%H%x00%ct%x00%an',
      ...input.window,
      '--',
      ...[
        ...item.paths.keys(),
      ].map(path => `:(literal)${path}`),
    ])
    for (const entry of parseLog(out)) {
      const commit = commits.get(entry.sha) ?? { at: entry.at, author: entry.author, files: [] }
      commits.set(entry.sha, commit)
      for (const file of entry.files) {
        const resource = item.paths.get(file.path)
        if (!resource)
          continue
        // Path-limited logs see a renamed file as added; follow it to its old path.
        const renamed = file.status === 'A'
          ? await renamedFrom(input.top, entry.sha, file.path)
          : undefined
        if (renamed) {
          queue.push({
            from: `${entry.sha}^`,
            paths: new Map([
              [renamed.path, resource],
            ]),
          })
        }
        commit.files.push({ resource, before: renamed?.blob ?? file.before, after: file.after })
      }
    }
  }
  return commits
}

/** Message changes per key and locale: in each commit, the messages of a locale's changed files before and after. */
async function walk(input: WalkInput): Promise<Changes> {
  const commits = await collectCommits(input)
  const shas = new Set([
    ...commits.values(),
  ].flatMap(commit => commit.files.flatMap(file => [file.before, file.after].filter(sha => sha !== undefined))))
  const blobs = await readBlobs(input.top, [...shas])
  const parsed = new Map<string, ReadonlyMap<KeyString, MessageLeaf> | undefined>()
  const messagesOf = (resource: Resource, sha: string | undefined): ReadonlyMap<KeyString, MessageLeaf> | undefined => {
    if (sha === undefined)
      return new Map()
    const id = `${resource.id}\0${sha}`
    if (!parsed.has(id)) {
      const text = blobs.get(sha)
      parsed.set(id, text === undefined
        ? undefined
        : input.ctx.messagesIn(resource, text))
    }
    return parsed.get(id)
  }

  const changes: Changes = new Map()
  for (const [sha, commit] of commits) {
    const byLocale = Map.groupBy(commit.files, file => file.resource.locale)
    for (const [locale, files] of byLocale) {
      const before = new Map<KeyString, MessageLeaf>()
      const after = new Map<KeyString, MessageLeaf>()
      for (const file of files) {
        const old = messagesOf(file.resource, file.before)
        const next = messagesOf(file.resource, file.after)
        // A version that does not parse says nothing about what changed.
        if (!old || !next)
          continue
        old.forEach((value, key) => before.has(key) || before.set(key, value))
        next.forEach((value, key) => after.has(key) || after.set(key, value))
      }
      for (const [key, value] of after) {
        if (before.has(key) && before.get(key) === value)
          continue
        const byKey = changes.get(key) ?? new Map<LocaleCode, Change[]>()
        changes.set(key, byKey)
        byKey.set(locale, [
          ...byKey.get(locale) ?? [],
          [commit.at, sha, commit.author, value],
        ])
      }
    }
  }
  for (const byKey of changes.values()) {
    for (const list of byKey.values())
      list.sort((a, b) => b[0] - a[0])
  }
  return changes
}

/** Messages at HEAD per locale, to tell uncommitted edits. */
async function headValues(ctx: HistoryContext, top: string, resources: ReadonlyMap<string, Resource>): Promise<Map<LocaleCode, Map<KeyString, MessageLeaf>>> {
  const out = await git(top, [
    'ls-tree',
    '-r',
    'HEAD',
    '--',
    ...resources.keys(),
  ])
  const files = out.split('\n').flatMap((line) => {
    const [meta = '', path = ''] = line.split('\t')
    const resource = resources.get(path)
    return resource
      ? [
          { resource, sha: meta.split(' ')[2]! },
        ]
      : []
  })
  const blobs = await readBlobs(top, files.map(file => file.sha))
  const values = new Map<LocaleCode, Map<KeyString, MessageLeaf>>()
  for (const { resource, sha } of files) {
    const byKey = values.get(resource.locale) ?? new Map<KeyString, MessageLeaf>()
    values.set(resource.locale, byKey)
    const text = blobs.get(sha)
    if (text !== undefined)
      ctx.messagesIn(resource, text)?.forEach((value, key) => byKey.has(key) || byKey.set(key, value))
  }
  return values
}

function toHistory(changes: Changes, head: ReadonlyMap<LocaleCode, ReadonlyMap<KeyString, MessageLeaf>>): MessageHistory {
  const latest = new Map<KeyString, Map<LocaleCode, MessageChange>>()
  for (const [key, byLocale] of changes) {
    const entries = new Map<LocaleCode, MessageChange>()
    latest.set(key, entries)
    for (const [locale, [newest]] of byLocale) {
      if (newest) {
        const value = head.get(locale)?.get(key)
        entries.set(locale, {
          updatedAt: newest[0],
          revision: newest[1],
          author: newest[2],
          value: value === undefined
            ? newest[3]
            : value,
        })
      }
    }
  }
  return {
    changes: latest,
    valueAt: (key, locale, at) => changes.get(key)?.get(locale)?.find(change => change[0] <= at)?.[3],
  }
}

function fromWalked(walked: Walked): Changes {
  return new Map(walked.changes.map(([key, byLocale]) => [
    key,
    new Map(byLocale),
  ]))
}

function toWalked(head: string, changes: Changes): Walked {
  return {
    head,
    changes: [...changes].map(([key, byLocale]) => [
      key,
      [...byLocale],
    ]),
  }
}

/** Fresh changes first, so lists stay newest first. */
function mergeChanges(fresh: Changes, older: Changes): Changes {
  for (const [key, byLocale] of older) {
    const target = fresh.get(key) ?? new Map<LocaleCode, Change[]>()
    fresh.set(key, target)
    for (const [locale, list] of byLocale) {
      target.set(locale, [
        ...target.get(locale) ?? [],
        ...list,
      ])
    }
  }
  return fresh
}

function isNotInstalled(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Reads when each message last changed from git: parsed messages per commit, so formatting, sorting and moves do not count. */
export function gitHistory(): Plugin {
  const warned = new Set<string>()
  const warnOnce = (ctx: HistoryContext, message: string): void => {
    if (!warned.has(message)) {
      warned.add(message)
      ctx.host.logger?.warn(message)
    }
  }

  async function load(ctx: HistoryContext): Promise<MessageHistory | undefined> {
    const options = ctx.config.history === false
      ? false
      : ctx.config.history.git
    if (options === false)
      return undefined
    const run = (args: readonly string[]): Promise<string> => git(ctx.host.root, args)
    let top: string
    try {
      top = (await run(['rev-parse', '--show-toplevel'])).trim()
    }
    catch (error) {
      if (isNotInstalled(error))
        warnOnce(ctx, 'git is not installed, so stale translations are not reported.')
      return undefined
    }
    if ((await run(['rev-parse', '--is-shallow-repository'])).trim() === 'true') {
      warnOnce(ctx, 'The git clone is shallow, so stale translations are not reported. Fetch the full history (`fetch-depth: 0` in GitHub Actions).')
      return undefined
    }
    const head = (await run([
      'rev-parse',
      '--verify',
      '--quiet',
      'HEAD',
    ]).catch(() => '')).trim()
    const prefix = (await run(['rev-parse', '--show-prefix'])).trim()
    const resources = new Map(ctx.resources.filter(resource => !resource.block).map(resource => [`${prefix}${resource.path}`, resource]))
    if (!head || resources.size === 0)
      return undefined

    const window = [
      ...options?.maxDepth === undefined
        ? []
        : [`--max-count=${options.maxDepth}`],
      ...options?.since === undefined
        ? []
        : [`--since=${options.since instanceof Date
            ? options.since.toISOString()
            : options.since}`],
    ]
    // A window moves with time, so only full walks are cached.
    const cache = window.length === 0
      ? ctx.host.cache
      : undefined
    const signature = [
      1,
      version,
      [...resources].map(([path, r]) => [
        path,
        r.locale,
        r.namespace,
        r.format,
        r.keySeparator,
      ]).sort(),
      ctx.config.namespace,
      ctx.config.keyStyle,
      ctx.config.keySeparator,
    ]
    const cacheKey = `git-history:${hashText(JSON.stringify(signature))}`
    const cachedText = await cache?.get(cacheKey)
    const cached = cachedText === undefined
      ? undefined
      : JSON.parse(cachedText) as Walked // written below
    let changes: Changes
    if (cached?.head === head) {
      changes = fromWalked(cached)
    }
    else {
      const base = cached && await run([
        'merge-base',
        '--is-ancestor',
        cached.head,
        head,
      ]).then(() => cached, () => undefined)
      const fresh = await walk({
        ctx,
        top,
        resources,
        head,
        base: base?.head,
        window,
      })
      changes = base
        ? mergeChanges(fresh, fromWalked(base))
        : fresh
      await cache?.set(cacheKey, JSON.stringify(toWalked(head, changes)))
    }
    return toHistory(changes, await headValues(ctx, top, resources))
  }

  function watch(ctx: HistoryContext, onChange: () => void): Disposable {
    let watcher: FSWatcher | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const run = (args: readonly string[]): Promise<string> => git(ctx.host.root, args)
    void Promise.all([
      run(['rev-parse', '--absolute-git-dir']),
      run(['rev-parse', '--path-format=absolute', '--git-common-dir']),
    ]).then(([dir, common]) => {
      if (disposed)
        return
      watcher = chokidar([
        join(dir.trim(), 'HEAD'),
        join(common.trim(), 'refs/heads'),
        join(common.trim(), 'packed-refs'),
      ], { ignoreInitial: true })
      watcher.on('all', () => {
        clearTimeout(timer)
        timer = setTimeout(onChange, 100)
      })
    }, () => undefined)
    return {
      dispose() {
        disposed = true
        clearTimeout(timer)
        void watcher?.close()
      },
    }
  }

  const provider: HistoryProvider = { id: 'git', load, watch }
  return {
    name: 'x18n:git-history',
    runtime: 'node',
    histories: [provider],
  }
}
