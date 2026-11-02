import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withServer } from './helpers/lsp-stdio.mjs'

const SERVER = join(process.cwd(), 'node_modules/@x18n/lsp/bin.mjs')

test('empty workspaceFolders falls back to rootUri (@x18n/lsp 0.1.5+)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'x18n-zed-root-'))

  try {
    await mkdir(join(root, 'locales'), { recursive: true })
    await writeFile(
      join(root, 'x18n.config.json'),
      JSON.stringify({
        sourceLocale: 'en',
        locales: [{ code: 'en', files: ['locales/en.json'] }],
      }),
    )
    await writeFile(join(root, 'locales/en.json'), JSON.stringify({ hello: 'Hello' }))

    await withServer(SERVER, async ({ request, notify }) => {
      await request('initialize', {
        processId: null,
        rootUri: `file://${root}`,
        workspaceFolders: [],
        capabilities: {},
        initializationOptions: { showFlags: false },
      })
      notify('initialized', {})
      const explain = await request('x18n/explain', null)
      assert.match(String(explain), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
