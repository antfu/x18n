import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import { execFile, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../../../cli/bin.mjs', import.meta.url))
const fixtures = fileURLToPath(new URL('../../../../test/fixtures/', import.meta.url))

export interface UiInfo {
  url: string
  code?: string
  link?: string
  mcp: { url: string, token: string }
}

/** A fresh copy of the vue-i18n fixture. */
export async function fixture(): Promise<{ root: string, dispose: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'x18n-e2e-'))
  const root = join(dir, 'vue-i18n')
  await cp(join(fixtures, 'vue-i18n'), root, { recursive: true })
  await writeFile(join(root, '.gitignore'), '')
  return {
    root,
    dispose: () => rm(dir, { recursive: true, force: true }),
  }
}

/** A fresh project of the given files. */
export async function project(files: Record<string, string>): Promise<{ root: string, dispose: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'x18n-e2e-'))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  return {
    root,
    dispose: () => rm(root, { recursive: true, force: true }),
  }
}

/** Runs `x18n ui --json` and resolves with the printed URLs once it listens. */
export function startUi(root: string, args: string[] = []): Promise<{ info: UiInfo, child: ChildProcess }> {
  const child = spawn(process.execPath, [
    bin,
    'ui',
    '--json',
    '--no-open',
    '--no-cache',
    '--port',
    '0',
    ...args,
  ], { cwd: root })
  let out = ''
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      try {
        resolve({ info: JSON.parse(out).data, child })
      }
      catch {}
    })
    child.on('exit', code => reject(new Error(`x18n ui exited with ${code}`)))
  })
}

export function buildReport(root: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      bin,
      'build',
      '--out-dir',
      outDir,
      '--no-cache',
    ], { cwd: root }, error => error
      ? reject(error)
      : resolve())
  })
}

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
}

/** Serves a folder like any static host: no fallback route, no backend. */
export async function serveStatic(dir: string): Promise<{ url: string, close: () => void }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    readFile(join(dir, path.endsWith('/')
      ? `${path}index.html`
      : path)).then((body) => {
      res.writeHead(200, { 'content-type': types[extname(path) || '.html'] ?? 'application/octet-stream' }).end(body)
    }, () => res.writeHead(404).end())
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${typeof address === 'object' && address
      ? address.port
      : 0}/`,
    close: () => server.close(),
  }
}
