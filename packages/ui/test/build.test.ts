import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadWorkspace } from '@x18n/node'
import { createX18nDevframe } from '@x18n/ui'
import { createBuild } from 'devframe/adapters/build'
import { expect, it } from 'vitest'

const fixtures = fileURLToPath(new URL('../../../test/fixtures/', import.meta.url))
// `pnpm test` builds first; tests run against sources, so point at the built SPA.
const spa = fileURLToPath(new URL('../dist/public', import.meta.url))

it('writes a static report with the SPA and the dumped data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'x18n-ui-build-'))
  try {
    const root = join(dir, 'vue-i18n')
    await cp(join(fixtures, 'vue-i18n'), root, { recursive: true })
    const workspace = await loadWorkspace({ cwd: root, cache: false })
    const outDir = join(dir, 'report')
    await createBuild(createX18nDevframe(workspace.projects), { outDir, distDir: spa })

    const html = await readFile(join(outDir, 'index.html'), 'utf8')
    expect(html).toContain('<div id="__nuxt">')
    // Relative asset URLs keep the report working under any path.
    expect(html).toContain('src="./_nuxt/')
    expect(html).not.toContain('"/_nuxt/')
    expect(JSON.parse(await readFile(join(outDir, '__connection.json'), 'utf8')).backend).toBe('static')
    const manifest = JSON.parse(await readFile(join(outDir, '__rpc-dump/index.json'), 'utf8'))
    expect(Object.keys(manifest).filter(name => name.startsWith('x18n:')).sort()).toEqual([
      'x18n:analysis',
      'x18n:diagnostics',
      'x18n:explain',
      'x18n:extract-candidates',
      'x18n:extract-selections',
      'x18n:key',
      'x18n:keys',
      'x18n:project',
      'x18n:reviews',
      'x18n:usages',
    ])
    expect(Object.keys(manifest['x18n:key'].records)).toHaveLength(workspace.projects[0]!.project.keys().length)
    const project = JSON.parse(await readFile(join(outDir, manifest['x18n:project'].path), 'utf8')).output
    expect(project.projects[0]).toMatchObject({ name: 'vue-i18n', sourceLocale: 'en', keys: 8 })
    const keys = JSON.parse(await readFile(join(outDir, Object.values<string>(manifest['x18n:keys'].records)[0]!), 'utf8')).output
    expect(keys.rows.find((row: { key: string }) => row.key === 'nav.home').values).toEqual({ en: 'Home', de: 'Start' })
    // Every query the SPA sends is dumped: page 0 of all diagnostics at least, and one per check and per locale.
    const diagnostics = workspace.projects[0]!.project.analyze().diagnostics
    const codes = new Set(diagnostics.map(d => d.code))
    expect(Object.keys(manifest['x18n:diagnostics'].records)).toHaveLength(1 + codes.size + workspace.projects[0]!.project.locales.length)
    workspace.projects.forEach(p => p.project.dispose())
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
})
