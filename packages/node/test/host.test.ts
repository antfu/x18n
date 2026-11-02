import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNodeHost, loadWorkspace } from '../src'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'x18n-node-'))
  await mkdir(join(root, '.git'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function write(files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
}

describe('createNodeHost', () => {
  it('writes into missing directories, reads back and deletes', async () => {
    const host = createNodeHost(root)
    await host.writeFile('locales/de/common.json', '{}\n')
    expect(await readFile(join(root, 'locales/de/common.json'), 'utf8')).toBe('{}\n')
    expect(await host.readFile('locales/de/common.json')).toBe('{}\n')
    await host.deleteFile('locales/de/common.json')
    expect(await host.readFile('locales/de/common.json')).toBeUndefined()
  })

  it('globs with gitignore, including nested ignore files', async () => {
    await write({
      '.gitignore': 'ignored/\n',
      'src/a.ts': '',
      'ignored/b.ts': '',
      'src/gen/.gitignore': '*.ts\n',
      'src/gen/c.ts': '',
    })
    const host = createNodeHost(root)
    expect(await host.glob(['**/*.ts'], { gitignore: true })).toEqual(['src/a.ts'])
    expect(await host.glob(['**/*.ts'])).toEqual(['ignored/b.ts', 'src/a.ts', 'src/gen/c.ts'])
  })

  it('persists the cache across hosts', async () => {
    const host = createNodeHost(root)
    await host.cache!.set('k', 'v')
    await host.flush()
    expect(await createNodeHost(root).cache!.get('k')).toBe('v')
  })

  it('reads the review identity from git config', async () => {
    await rm(join(root, '.git'), { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Ada'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'ada@example.com'], { cwd: root })
    expect(await createNodeHost(root).identity!()).toEqual({ name: 'Ada', email: 'ada@example.com' })
  })

  it('reports file events when watching', async () => {
    const host = createNodeHost(root)
    const events: string[] = []
    const watcher = host.watch!(['**/*'], list => events.push(...list.map(e => `${e.type}:${e.path}`)))
    await new Promise(resolve => setTimeout(resolve, 200))
    await write({ 'a.json': '{}' })
    await expect.poll(() => events, { timeout: 3000 }).toContain('create:a.json')
    watcher.dispose()
  })
})

describe('loadWorkspace', () => {
  const locales = { 'locales/en.json': '{"a":"A"}', 'locales/de.json': '{}' }

  it.each([
    ['x18n.config.ts', 'export default { sourceLocale: \'de\' }'],
    ['x18n.config.mjs', 'export default { sourceLocale: \'de\' }'],
    ['x18n.config.yml', 'sourceLocale: de\n'],
    ['x18n.config.json', '{ "sourceLocale": "de" }'],
  ])('loads %s', async (file, content) => {
    await write({ ...locales, [file]: content })
    const workspace = await loadWorkspace({
      cwd: join(root, 'locales'),
      cache: false,
    })
    expect(workspace.configFile).toBe(join(root, file))
    expect(workspace.projects[0]!.project.sourceLocale).toBe('de')
  })

  it('resolves preset factories in a TS config without a project install', async () => {
    await write({
      ...locales,
      'x18n.config.ts': [
        'import { i18next } from \'@x18n/builtins/presets/i18next\'',
        'import { reactI18next } from \'@x18n/builtins/presets/react-i18next\'',
        'import { defineConfig } from \'@x18n/core\'',
        'export default defineConfig({ presets: [i18next(), reactI18next()] })',
      ].join('\n'),
    })
    const [loaded] = (await loadWorkspace({ cwd: root, cache: false })).projects
    expect(loaded!.project.explain().presets.map(p => [p.name, p.reason])).toEqual([
      ['i18next', 'listed'],
      ['react-i18next', 'listed'],
    ])
  })

  it('reports invalid YAML config keys', async () => {
    await write({ 'x18n.config.yml': 'sourceLocal: de\n' })
    await expect(loadWorkspace({ cwd: root, cache: false })).rejects.toMatchObject({ code: 'X18N0001' })
  })

  it('runs without a config file on detection', async () => {
    await write({ ...locales, 'package.json': '{"dependencies":{"vue-i18n":"9"}}' })
    const [loaded] = (await loadWorkspace({ cwd: root, cache: false })).projects
    expect(loaded!.project.keys()).toEqual(['a'])
    expect(loaded!.project.explain().presets.find(p => p.name === 'vue-i18n')?.reason).toBe('detected')
  })

  it('loads monorepo projects that inherit the root config', async () => {
    await write({
      'x18n.config.json': '{ "projects": ["apps/*"], "sourceLocale": "de" }',
      'apps/web/locales/de.json': '{"a":"A"}',
      'apps/docs/locales/de.json': '{"b":"B"}',
      'apps/docs/x18n.config.json': '{ "name": "documentation" }',
    })
    const workspace = await loadWorkspace({ cwd: root, cache: false })
    expect(workspace.projects.map(p => [
      p.name,
      p.project.sourceLocale,
      p.project.keys(),
    ])).toEqual([
      [
        'documentation',
        'de',
        ['b'],
      ],
      [
        'apps/web',
        'de',
        ['a'],
      ],
    ])
    const only = await loadWorkspace({ cwd: root, cache: false, project: 'apps/web' })
    expect(only.projects.map(p => p.name)).toEqual(['apps/web'])
  })

  it('does not expand a literal projects path into nested directories', async () => {
    await write({
      'x18n.config.json': '{ "projects": ["apps/web"], "sourceLocale": "en" }',
      'apps/web/locales/en.json': '{"a":"A"}',
      'apps/web/locales/de.json': '{"a":"A"}',
      'apps/web/src/a/b/x.ts': 'export const x = t("a")',
      'apps/web/src/c/y.ts': '',
      'apps/docs/locales/en.json': '{"b":"B"}',
    })
    const workspace = await loadWorkspace({ cwd: root, cache: false })
    expect(workspace.projects.map(p => p.name)).toEqual(['apps/web'])
    expect(workspace.projects[0]!.project.keys()).toEqual(['a'])
  })

  it('loads each config below a root without one as its own project', async () => {
    await write({
      'apps/web/x18n.config.json': '{ "sourceLocale": "de" }',
      'apps/web/locales/de.json': '{"a":"A"}',
      'apps/shop/x18n.config.json': '{ "projects": ["packages/*"], "sourceLocale": "fr" }',
      'apps/shop/packages/cart/x18n.config.json': '{ "name": "cart" }',
      'apps/shop/packages/cart/locales/fr.json': '{"b":"B"}',
      'node_modules/lib/x18n.config.json': '{}',
    })
    const workspace = await loadWorkspace({ cwd: root, cache: false })
    expect(workspace.root).toBe(root)
    expect(workspace.projects.map(p => [
      p.name,
      p.project.sourceLocale,
      p.project.keys(),
    ])).toEqual([
      [
        'cart',
        'fr',
        ['b'],
      ],
      [
        'apps/web',
        'de',
        ['a'],
      ],
    ])
  })

  it('loads YAML plugins referenced from the config', async () => {
    await write({
      ...locales,
      'x18n.config.json': '{ "plugins": ["./acme.x18n-plugin.yml"] }',
      'acme.x18n-plugin.yml': 'name: acme\nconfig:\n  sourceLocale: de\n',
    })
    const [loaded] = (await loadWorkspace({ cwd: root, cache: false })).projects
    expect(loaded!.project.sourceLocale).toBe('de')
  })

  it('detects presets from the workspace packages of a monorepo', async () => {
    await write({
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'packages/app/package.json': '{"dependencies":{"vue-i18n":"11"}}',
      'packages/app/locales/en.json': '{"a":"A"}',
      'packages/app/src/App.vue': '<template>{{ $t(\'a\') }}</template>',
    })
    const [loaded] = (await loadWorkspace({ cwd: root, cache: false })).projects
    expect(loaded!.project.explain().presets.find(p => p.name === 'vue-i18n')?.reason).toBe('detected')
    expect(loaded!.project.analyze().unused).toEqual([])
  })

  it('falls back to i18n-ally settings without a config', async () => {
    await write({
      '.vscode/settings.json': '{\n  // comments are fine\n  "i18n-ally.localesPaths": ["lang"],\n  "i18n-ally.sourceLanguage": "de",\n  "i18n-ally.keysInUse": ["runtime.*"],\n  "i18n-ally.enabledFrameworks": ["vue"],\n}\n',
      'lang/de.json': '{"a":"A","runtime":{"x":"X"}}',
      'lang/index.ts': 'export {}',
      'src/a.ts': 't(\'a\')',
    })
    const workspace = await loadWorkspace({
      cwd: join(root, 'src'),
      cache: false,
    })
    const project = workspace.projects[0]!.project
    expect(workspace.configFile).toBeUndefined()
    expect(workspace.projects[0]!.configFile).toBe(join(root, '.vscode/settings.json'))
    expect(project.sourceLocale).toBe('de')
    expect(project.locales).toEqual(['de'])
    expect(project.analyze().unused).toEqual([])
  })

  it('guesses locale files when the i18n-ally paths are stale, and prefers a config file', async () => {
    await write({
      '.vscode/settings.json': '{ "i18n-ally.localesPaths": ["app/i18n"] }',
      'packages/app/src/i18n/locales/en.json': '{"a":"A"}',
    })
    expect((await loadWorkspace({ cwd: root, cache: false })).projects[0]!.project.keys()).toEqual(['a'])
    await write({ 'x18n.config.json': '{ "resources": [{ "pattern": "packages/app/src/i18n/locales/{locale}.json" }], "sourceLocale": "fr" }' })
    const [loaded] = (await loadWorkspace({ cwd: root, cache: false })).projects
    expect(loaded!.configFile).toBe(join(root, 'x18n.config.json'))
    expect(loaded!.project.sourceLocale).toBe('fr')
  })
})
