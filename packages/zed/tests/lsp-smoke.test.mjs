import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withServer } from './helpers/lsp-stdio.mjs'

const SERVER = join(process.cwd(), 'node_modules/@x18n/lsp/bin.mjs')

test('x18n-lsp responds to initialize with expected capabilities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'x18n-zed-smoke-'))
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
    const result = await request('initialize', {
      processId: null,
      rootUri: `file://${root}`,
      capabilities: {},
      initializationOptions: { showFlags: false },
    })
    notify('initialized', {})
    assert.equal(result.serverInfo.name, 'x18n')
    assert.equal(result.capabilities.hoverProvider, true)
    assert.equal(result.capabilities.renameProvider.prepareProvider, true)
    const codeActions = result.capabilities.codeActionProvider
    const kinds = codeActions === true ? [] : codeActions.codeActionKinds
    assert.ok(kinds.includes('quickfix'))
  })
})
