import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { version } from '../package.json' with { type: 'json' }

// Git hooks set GIT_DIR and friends; they would point every git call here at the repo running the hook.
for (const name of Object.keys(process.env).filter(name => name.startsWith('GIT_')))
  delete process.env[name]

const bin = fileURLToPath(new URL('../bin.mjs', import.meta.url))
const fixtures = fileURLToPath(new URL('../../../test/fixtures/', import.meta.url))
let work: string

interface Result { stdout: string, stderr: string, code: number }

function x18n(cwd: string, args: string[], input?: string): Promise<Result> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [bin, ...args, '--no-cache'], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
    }, (error, stdout, stderr) => {
      resolve({
        stdout,
        stderr,
        code: error
          ? Number(error.code ?? 1)
          : 0,
      })
    })
    if (input !== undefined) {
      child.stdin!.write(input)
      child.stdin!.end()
    }
  })
}

async function fixture(name: string): Promise<string> {
  const dir = join(work, `${name}-${Math.random().toString(36).slice(2)}`)
  await cp(join(fixtures, name), dir, { recursive: true })
  await writeFile(join(dir, '.gitignore'), '')
  return dir
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'x18n-cli-'))
})

afterAll(async () => {
  // Windows can keep a directory locked for a moment after the process using it exits.
  await rm(work, { recursive: true, force: true, maxRetries: 5 })
})

function json(result: Result): any {
  return JSON.parse(result.stdout)
}

// Every test spawns the binary, some spawn git too, and Windows runners are slow at both.
describe('x18n binary', { timeout: 30_000 }, () => {
  it('prints its version', async () => {
    const { stdout } = await x18n(work, ['--version'])
    expect(stdout).toContain(`x18n/${version}`)
  })

  it('check prints diagnostics with code frames and fails on errors', async () => {
    const dir = await fixture('vue-i18n')
    const result = await x18n(dir, ['check'])
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('src/locales/de.json:4:6\n ERROR  "app.greeting" in de has different placeholders than en: missing name.  placeholder-mismatch\n')
    expect(result.stdout).toMatch(/✖ \d+ errors?(?: {2}⚠ \d+ warnings?)? {2}\d+ files?\n$/)
  })

  it('check --json follows the contract', async () => {
    const dir = await fixture('i18next')
    const result = await x18n(dir, ['check', '--json'])
    const data = json(result)
    expect(data.x18n).toBe(2)
    expect(data.command).toBe('check')
    expect(data.diagnostics.find((d: any) => d.code === 'placeholder-mismatch')).toMatchObject({
      key: 'auth:login.submit',
      locale: 'de',
      file: 'public/locales/de/auth.json',
      range: { line: 4, column: 6 },
    })
  })

  it('check narrows with --only and fails on --max-warnings', async () => {
    const dir = await fixture('vue-i18n')
    expect((await x18n(dir, ['check', '--only', 'empty-translation'])).code).toBe(0)
    expect((await x18n(dir, [
      'check',
      '--only',
      'empty-translation',
      '--max-warnings',
      '0',
    ])).code).toBe(1)
    const github = await x18n(dir, [
      'check',
      '--only',
      'empty-translation',
      '--reporter',
      'github',
    ])
    expect(github.stdout).toContain('::warning file=src/locales/de.json,line=8,col=6')
  })

  it('check --update-baseline writes a stable baseline that leaves out known diagnostics', async () => {
    const dir = await fixture('vue-i18n')
    const file = join(dir, '.x18n/check-baseline.json')
    const update = await x18n(dir, ['check', '--update-baseline'])
    expect(update.code).toBe(0)
    expect(update.stderr).toContain('Wrote 6 diagnostics to the baseline .x18n/check-baseline.json.')
    expect(update.stdout).toContain('Found no errors.\n\nThe baseline left out 6 known diagnostics.\n')
    const written = await readFile(file, 'utf8')
    const { diagnostics } = JSON.parse(written)
    expect(diagnostics[0]).toEqual({
      path: 'src/App.vue',
      code: 'missing-key',
      key: 'app.titel',
      locale: 'en',
      message: '"app.titel" is not defined in en.',
      count: 1,
    })
    expect(diagnostics.find((e: any) => e.code === 'unused-key')).not.toHaveProperty('locale')
    expect(diagnostics.map((e: any) => `${e.path} ${e.code} ${e.key}`)).toEqual(diagnostics.map((e: any) => `${e.path} ${e.code} ${e.key}`).sort())
    expect((await x18n(dir, ['check', '--update-baseline'])).code).toBe(0)
    expect(await readFile(file, 'utf8')).toBe(written)

    const known = json(await x18n(dir, ['check', '--json']))
    expect(known.diagnostics).toEqual([])
    expect(known.data.baseline).toEqual({ suppressed: 6, fixed: 0 })

    // A moved line stays known; one more identical diagnostic in the same file is new.
    const app = join(dir, 'src/App.vue')
    const source = await readFile(app, 'utf8')
    await writeFile(app, source.replace('<header>', '<header>\n    <p>moved</p>'))
    expect((await x18n(dir, ['check'])).code).toBe(0)
    await writeFile(app, source.replace(`<p>{{ title }}</p>`, `<p>{{ title }}</p>\n    <p>{{ $t('app.titel') }}</p>`))
    const duplicate = await x18n(dir, ['check', '--json'])
    expect(duplicate.code).toBe(1)
    expect(json(duplicate).diagnostics).toMatchObject([
      {
        code: 'missing-key',
        key: 'app.titel',
        file: 'src/App.vue',
        range: { line: 19 },
      },
    ])
    expect(json(duplicate).data.baseline).toEqual({ suppressed: 6, fixed: 0 })

    // Fixed diagnostics are counted, and --update-baseline drops them.
    await writeFile(app, source.replace(`<p>{{ $t('app.titel') }}</p>`, ''))
    const fixed = await x18n(dir, ['check'])
    expect(fixed.code).toBe(0)
    expect(fixed.stdout).toContain('The baseline left out 5 known diagnostics.\n\nFixed since the baseline: 1. Run `x18n check --update-baseline` to drop them from it.\n')
    await x18n(dir, [
      'check',
      '--update-baseline',
      '--skip',
      'unused-key',
    ])
    expect(JSON.parse(await readFile(file, 'utf8')).diagnostics).toHaveLength(5)
    expect(json(await x18n(dir, ['check', '--json'])).data.baseline).toEqual({ suppressed: 5, fixed: 0 })
  })

  it('check --baseline reads another file, and fails on a new diagnostic', async () => {
    const dir = await fixture('vue-i18n')
    await x18n(dir, [
      'check',
      '--update-baseline',
      '--baseline',
      'baseline.json',
      '--skip',
      'missing-key',
    ])
    const result = await x18n(dir, [
      'check',
      '--baseline',
      'baseline.json',
      '--json',
    ])
    expect(result.code).toBe(1)
    expect(json(result).diagnostics).toMatchObject([
      { code: 'missing-key' },
    ])
    // Without the file nothing is left out, and the JSON has no baseline.
    const all = json(await x18n(dir, ['check', '--json']))
    expect(all.diagnostics).toHaveLength(6)
    expect(all.data).not.toHaveProperty('baseline')
    await writeFile(join(dir, 'baseline.json'), '{')
    const invalid = await x18n(dir, ['check', '--baseline', 'baseline.json'])
    expect(invalid.code).toBe(2)
    expect(invalid.stderr).toContain('is not valid. Run `x18n check --update-baseline` to write it again.')
  })

  it('status, keys, get and locales return JSON', async () => {
    const dir = await fixture('i18next')
    const status = json(await x18n(dir, ['status', '--json'])).data.projects[0]
    expect(status).toMatchObject({ sourceLocale: 'en', resources: 4, keys: 6 })
    const keys = json(await x18n(dir, ['keys', '--json', '--limit', '2'])).data.projects[0]
    expect(keys).toMatchObject({
      total: 6,
      nextCursor: '2',
      keys: [
        { key: 'auth:login.submit' },
        { key: 'auth:login.title' },
      ],
    })
    const search = async (...args: string[]): Promise<string[]> => json(await x18n(dir, ['search', ...args, '--json'])).data.projects[0].matches.map((m: any) => `${m.key}:${m.locale}`)
    expect(await search('anmelden', '--exact')).toEqual(['auth:login.title:de', 'auth:login.submit:de'])
    expect(await search('sgn n')).toEqual(['auth:login.submit:en'])
    expect(await search('sgn n', '--exact')).toEqual([])
    const get = json(await x18n(dir, ['get', 'common:save', '--json'])).data.projects[0]
    expect(get.messages.map((m: any) => [m.locale, m.value])).toEqual([
      ['en', 'Save'],
      ['de', 'Speichern'],
    ])
    const locales = json(await x18n(dir, ['locales', '--json'])).data.projects[0]
    expect(locales.locales.map((l: any) => l.code)).toEqual(['en', 'de'])
  })

  it('review comments, suggests, applies and resolves', async () => {
    const dir = await fixture('i18next')
    const author = ['--author', 'Ada <ada@example.com>']
    expect((await x18n(dir, [
      'review',
      'request-change',
      'auth:login.title',
      '--locale',
      'de',
      '--text',
      'Too short',
      ...author,
    ])).code).toBe(0)
    expect((await x18n(dir, [
      'review',
      'suggest',
      'auth:login.title',
      '--locale',
      'de',
      '--value',
      'Einloggen',
      ...author,
    ])).code).toBe(0)
    const threads = json(await x18n(dir, ['review', 'list', '--json'])).data.projects[0].threads
    expect(threads).toMatchObject([
      {
        key: 'auth:login.title',
        locale: 'de',
        state: 'changes-requested',
        comments: [
          {
            type: 'request-change',
            text: 'Too short',
            author: { name: 'Ada', email: 'ada@example.com' },
          },
          { type: 'suggestion', suggestion: 'Einloggen' },
        ],
      },
    ])
    const [request, suggestion] = threads[0].comments
    const check = json(await x18n(dir, ['check', '--json']))
    expect(check.diagnostics.find((d: any) => d.code === 'review-changes-requested')).toMatchObject({ key: 'auth:login.title', locale: 'de', severity: 'info' })

    expect((await x18n(dir, ['review', 'apply-suggestion', suggestion.id])).code).toBe(0)
    expect(JSON.parse(await readFile(join(dir, 'public/locales/de/auth.json'), 'utf8')).login.title).toBe('Einloggen')
    expect((await x18n(dir, ['review', 'resolve', request.id])).code).toBe(0)
    expect((await x18n(dir, ['review', 'list', '--open'])).stdout).toBe('No open reviews.\n')
    expect((await x18n(dir, ['review', 'list'])).stdout).toContain('auth:login.title  de\n')
    expect(json(await x18n(dir, ['get', 'auth:login.title', '--json'])).data.projects[0].reviews[0].comments).toHaveLength(2)

    const missing = await x18n(dir, [
      'review',
      'comment',
      'auth:login.title',
      '--text',
      'Hm',
    ])
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('pass --locale <locale>')
  })

  it('doctor explains detected presets', async () => {
    const dir = await fixture('i18next')
    const projects = json(await x18n(dir, ['doctor', '--json'])).data.projects
    expect(projects[0].presets).toContainEqual({ name: 'react-i18next', reason: 'detected' })
    const { stdout } = await x18n(dir, ['doctor'])
    expect(stdout).toContain('config: none (detection only)\npresets:\n  ✓ react-i18next (detected)')
  })

  it('set, rename and delete write files; --dry-run does not', async () => {
    const dir = await fixture('vue-i18n')
    const en = join(dir, 'src/locales/en.json')
    const before = await readFile(en, 'utf8')
    const dry = await x18n(dir, [
      'set',
      'nav.contact',
      '--value',
      'Contact',
      '--dry-run',
    ])
    expect(dry.stdout).toContain('+     "contact": "Contact"')
    expect(await readFile(en, 'utf8')).toBe(before)

    expect((await x18n(dir, [
      'set',
      'nav.contact',
      '--value',
      'Contact',
    ])).code).toBe(0)
    expect(JSON.parse(await readFile(en, 'utf8')).nav.contact).toBe('Contact')

    expect((await x18n(dir, ['rename', 'nav.contact', 'nav.reach'])).code).toBe(0)
    expect(JSON.parse(await readFile(en, 'utf8')).nav).toEqual({ home: 'Home', about: 'About', reach: 'Contact' })

    expect((await x18n(dir, ['delete', 'nav.reach'])).code).toBe(0)
    expect(await readFile(en, 'utf8')).toBe(before)
  })

  it('rename refuses an existing target with exit code 1', async () => {
    const dir = await fixture('vue-i18n')
    const result = await x18n(dir, [
      'rename',
      'nav.home',
      'nav.about',
      '--json',
    ])
    expect(result.code).toBe(1)
    expect(json(result).errors[0].name).toBe('X18N4002')
  })

  it('apply validates placeholders before writing', async () => {
    const dir = await fixture('vue-i18n')
    const bad = await x18n(dir, ['apply', '-', '--json'], JSON.stringify({
      de: { 'app.greeting': 'Hallo' },
    }))
    expect(bad.code).toBe(1)
    expect(json(bad).data.rejected).toEqual([
      {
        key: 'app.greeting',
        locale: 'de',
        missing: ['name'],
        extra: [],
      },
    ])
    const good = await x18n(dir, ['apply', '-'], JSON.stringify({
      de: { 'app.greeting': 'Hallo {name}', 'pages.about.title': 'Über uns' },
    }))
    expect(good.code).toBe(0)
    const de = JSON.parse(await readFile(join(dir, 'src/locales/de.json'), 'utf8'))
    expect(de.pages.about.title).toBe('Über uns')
  })

  it('fill adds missing keys', async () => {
    const dir = await fixture('vue-i18n')
    await x18n(dir, ['fill', '--copy-source'])
    const de = JSON.parse(await readFile(join(dir, 'src/locales/de.json'), 'utf8'))
    expect(de.pages.about.title).toBe('About us')
  })

  it('init writes a config, schema prints JSON Schema', async () => {
    const dir = await fixture('vue-i18n')
    const result = await x18n(dir, ['init'])
    expect(result.code).toBe(0)
    expect(await readFile(join(dir, 'x18n.config.ts'), 'utf8')).toContain('pattern: \'src/locales/{locale}.{ext}\'')
    expect(JSON.parse((await x18n(dir, ['schema', 'plugin'])).stdout).title).toBe('x18n YAML plugin')
  })

  it('errors on config problems with exit code 2', async () => {
    const dir = await fixture('vue-i18n')
    await writeFile(join(dir, 'x18n.config.json'), '{ "sourceLocal": "en" }')
    const result = await x18n(dir, ['status'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('[X18N0001]')
  })

  it('reports stale translations from git history', async () => {
    const dir = await fixture('vue-i18n')
    const git = (args: string[], date: string): Promise<void> => new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: 'Ada',
        GIT_AUTHOR_EMAIL: 'ada@example.com',
        GIT_COMMITTER_NAME: 'Ada',
        GIT_COMMITTER_EMAIL: 'ada@example.com',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      }
      execFile('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, env }, error => error
        ? reject(error)
        : resolve())
    })
    await git(['init', '-q'], '')
    await git(['add', '-A'], '')
    await git(['commit', '-q', '-m', 'first'], '2026-01-01T00:00:00Z')
    const en = JSON.parse(await readFile(join(dir, 'src/locales/en.json'), 'utf8'))
    await writeFile(join(dir, 'src/locales/en.json'), JSON.stringify({
      ...en,
      app: { ...en.app, title: 'My Great App' },
    }, null, 2))
    await git(['commit', '-q', '-am', 'second'], '2026-02-01T00:00:00Z')

    const check = json(await x18n(dir, [
      'check',
      '--only',
      'stale-translation',
      '--json',
    ]))
    expect(check.diagnostics).toMatchObject([
      {
        code: 'stale-translation',
        key: 'app.title',
        locale: 'de',
        file: 'src/locales/de.json',
      },
    ])
    expect(check.diagnostics[0].message).toMatch(/^"app.title" in de is older than en \(source changed 2026-02-01 in [0-9a-f]{7}\)\.$/)
    expect(check.data.projects[0].coverage.find((c: any) => c.locale === 'de').outdated).toBe(1)
    const prompt = json(await x18n(dir, [
      'prompt',
      'translate',
      '--to',
      'de',
      '--stale',
      '--json',
    ]))
    expect(prompt.data.items.find((item: any) => item.key === 'app.title')).toMatchObject({ source: 'My Great App', previousSource: 'My App' })
    // `--check` loads the history too, for `stale-translation`.
    const checked = json(await x18n(dir, [
      'prompt',
      'translate',
      '--to',
      'de',
      '--check',
      'identical-to-source,stale-translation',
      '--json',
    ]))
    expect(checked.data.items.find((item: any) => item.key === 'app.title')).toMatchObject({
      previousSource: 'My App',
      issues: [
        { code: 'stale-translation' },
      ],
    })
  })

  it('prints the shipped skills as prompts', async () => {
    const dir = await fixture('vue-i18n')
    const setup = await x18n(dir, ['prompt', 'setup'])
    expect(setup.code).toBe(0)
    expect(setup.stdout).toContain('# Set up x18n')
    expect(setup.stdout).toContain('# Migrate from i18n-ally')
    expect(setup.stdout).not.toContain('name: x18n-setup')
    const check = await x18n(dir, ['prompt', 'check'])
    expect(check.code).toBe(0)
    expect(check.stdout).toContain('x18n check')
    expect(check.stdout).not.toContain('name: x18n-check')
  })

  it('keeps the JSON contract of every read command', async () => {
    const dir = await fixture('vue-i18n')
    const name = basename(dir)
    for (const args of [
      ['status'],
      ['keys', '--values'],
      ['get', 'app.greeting'],
      ['search', 'my app'],
      ['usages'],
      ['locales'],
      ['check'],
      ['review', 'list'],
      [
        'prompt',
        'translate',
        '--to',
        'de',
        '--format',
        'json',
      ],
    ]) {
      const result = await x18n(dir, [...args, '--json'])
      expect(result.stdout.replaceAll(name, '<fixture>')).toMatchSnapshot(args.join(' '))
    }
  }, 30_000)
})
