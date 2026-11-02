import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
})
