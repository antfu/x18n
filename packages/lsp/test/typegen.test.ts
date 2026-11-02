import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { createConnection, InitializeRequest } from 'vscode-languageserver/node'
import { methods, setupServer } from '../src'

let root: string
const disposers: (() => void)[] = []
function client(): ReturnType<typeof createMessageConnection> {
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
  setupServer(server)
  server.listen()
  const connection = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
  connection.listen()
  disposers.push(() => connection.dispose(), () => server.dispose())
  return connection
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'x18n-lsp-typegen-'))
  await mkdir(join(root, 'locales'))
  await writeFile(join(root, 'tsconfig.json'), '{}')
  await writeFile(join(root, 'x18n.config.yml'), 'typegen: true\npresets: [i18next]\nsourceLocale: en\nresources:\n  - pattern: locales/{locale}.json\n')
  await writeFile(join(root, 'locales/en.json'), '{"a":"A"}\n')
})

afterAll(async () => {
  disposers.splice(0).forEach(dispose => dispose())
  await rm(root, { recursive: true, force: true })
})

describe('typegen in the language server', () => {
  it('writes the file after a resource changes, and leaves it alone when it matches', async () => {
    const connection = client()
    await connection.sendRequest(InitializeRequest.type, { processId: null, rootUri: pathToFileURL(root).href, capabilities: {} })
    await connection.sendNotification('initialized', {})
    await connection.sendRequest(methods.projects)

    const path = join(root, 'locales/en.json')
    await writeFile(path, '{"a":"Changed"}\n')
    await connection.sendNotification('workspace/didChangeWatchedFiles', {
      changes: [
        { uri: pathToFileURL(path).href, type: 2 },
      ],
    })
    const output = join(root, 'x18n.d.ts')
    await vi.waitFor(async () => expect(await readFile(output, 'utf8')).toContain('"a": "Changed"'), { timeout: 5000, interval: 50 })

    const written = (await stat(output)).mtimeMs
    await connection.sendNotification('workspace/didChangeWatchedFiles', {
      changes: [
        { uri: pathToFileURL(output).href, type: 2 },
      ],
    })
    await new Promise(done => setTimeout(done, 600))
    expect((await stat(output)).mtimeMs).toBe(written)
  })
})
