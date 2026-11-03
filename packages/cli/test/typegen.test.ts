import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const bin = fileURLToPath(new URL('../bin.mjs', import.meta.url))
let root: string

function x18n(cwd: string, ...args: string[]): Promise<{ stdout: string, code: number }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [bin, ...args, '--no-cache'], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
    }, (error, stdout) => {
      resolve({
        stdout,
        code: error
          ? Number(error.code ?? 1)
          : 0,
      })
    })
  })
}

async function project(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(root, name)
  await mkdir(join(dir, 'locales'), { recursive: true })
  await writeFile(join(dir, 'x18n.config.yml'), 'typegen: true\npresets: [i18next]\nsourceLocale: en\nresources:\n  - pattern: locales/{locale}.json\n')
  await writeFile(join(dir, 'locales/en.json'), '{"a":"A"}\n')
  for (const [path, content] of Object.entries(files))
    await writeFile(join(dir, path), content)
  return dir
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'x18n-typegen-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('x18n typegen', () => {
  it('writes the file once and keeps check quiet after', async () => {
    const dir = await project('ts', { 'tsconfig.json': '{}' })
    expect((await x18n(dir, 'check', '--only', 'typegen-stale')).code).not.toBe(0)
    expect((await x18n(dir, 'typegen')).stdout).toContain('Wrote x18n.d.ts (i18next).')
    expect(await readFile(join(dir, 'x18n.d.ts'), 'utf8')).toContain('"a": "A"')
    expect((await x18n(dir, 'typegen')).stdout).toContain('x18n.d.ts is up to date.')
    expect((await x18n(dir, 'check', '--only', 'typegen-stale')).code).toBe(0)
  })

  it('skips a project without TypeScript, in check as well', async () => {
    const dir = await project('plain', {})
    expect((await x18n(dir, 'typegen')).stdout).toContain('Typegen needs a tsconfig.json or typescript')
    expect((await x18n(dir, 'check', '--only', 'typegen-stale')).code).toBe(0)
  })

  it('reports as JSON', async () => {
    const dir = await project('json', { 'tsconfig.json': '{}' })
    const { data } = JSON.parse((await x18n(dir, 'typegen', '--json')).stdout)
    expect(data.projects[0]).toMatchObject({ path: 'x18n.d.ts', target: 'i18next', changed: true })
  })
  it('creates the folder of the output', async () => {
    const dir = await project('nested', { 'tsconfig.json': '{}' })
    await writeFile(join(dir, 'x18n.config.yml'), 'typegen:\n  output: ./types/deep/x18n.d.ts\npresets: [i18next]\nsourceLocale: en\nresources:\n  - pattern: locales/{locale}.json\n')
    expect((await x18n(dir, 'typegen')).stdout).toContain('Wrote types/deep/x18n.d.ts (i18next).')
    expect(await readFile(join(dir, 'types/deep/x18n.d.ts'), 'utf8')).toContain('"a": "A"')
    expect((await x18n(dir, 'check', '--only', 'typegen-stale')).code).toBe(0)
  })

  it('reports a failed write in watch mode and keeps watching', async () => {
    const dir = await project('watch', { 'tsconfig.json': '{}' })
    await writeFile(join(dir, 'x18n.config.yml'), 'typegen:\n  output: types/x18n.d.ts\npresets: [i18next]\nsourceLocale: en\nresources:\n  - pattern: locales/{locale}.json\n')
    const child = spawn(process.execPath, [
      bin,
      'typegen',
      '--watch',
      '--no-cache',
    ], {
      cwd: dir,
      env: { ...process.env, NO_COLOR: '1' },
    })
    let stdout = ''
    let stderr = ''
    let exited = false
    child.stdout.on('data', (chunk: unknown) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk: unknown) => {
      stderr += String(chunk)
    })
    child.on('exit', () => {
      exited = true
    })
    try {
      await vi.waitFor(() => expect(stdout).toContain('Watching for file changes.'), { timeout: 10000, interval: 50 })
      // A file where the folder should be makes the write fail.
      await rm(join(dir, 'types'), { recursive: true })
      await writeFile(join(dir, 'types'), '')
      await writeFile(join(dir, 'locales/en.json'), '{"a":"Blocked"}\n')
      await vi.waitFor(() => expect(stderr).toContain('error: '), { timeout: 10000, interval: 50 })
      await rm(join(dir, 'types'))
      await writeFile(join(dir, 'locales/en.json'), '{"a":"Back"}\n')
      await vi.waitFor(async () => expect(await readFile(join(dir, 'types/x18n.d.ts'), 'utf8')).toContain('"a": "Back"'), { timeout: 10000, interval: 50 })
      expect(exited).toBe(false)
    }
    finally {
      child.kill()
    }
  }, 30000)
})
