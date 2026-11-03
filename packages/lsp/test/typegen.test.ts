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
  it('tells the project about the file it wrote, so that typegen-stale clears without file watching', async () => {
    const connection = client()
    const latest = new Map<string, { code?: unknown }[]>()
    let reported = false
    connection.onNotification('textDocument/publishDiagnostics', (params: { uri: string, diagnostics: { code?: unknown }[] }) => {
      latest.set(params.uri, params.diagnostics)
      reported ||= params.diagnostics.some(d => d.code === 'typegen-stale')
    })
    await connection.sendRequest(InitializeRequest.type, { processId: null, rootUri: pathToFileURL(root).href, capabilities: {} })
    await connection.sendNotification('initialized', {})
    await connection.sendRequest(methods.projects)

    const path = join(root, 'locales/en.json')
    await writeFile(path, '{"a":"Again"}\n')
    await connection.sendNotification('workspace/didChangeWatchedFiles', {
      changes: [
        { uri: pathToFileURL(path).href, type: 2 },
      ],
    })
    const output = pathToFileURL(join(root, 'x18n.d.ts')).href
    await vi.waitFor(async () => expect(await readFile(join(root, 'x18n.d.ts'), 'utf8')).toContain('"a": "Again"'), { timeout: 5000, interval: 50 })
    expect(reported).toBe(true)
    await vi.waitFor(() => expect(latest.get(output)?.some(d => d.code === 'typegen-stale') ?? false).toBe(false), { timeout: 5000, interval: 50 })
  })

  it('creates the folder of the output, and logs a failed write', async () => {
    const dir = join(root, 'nested')
    await mkdir(join(dir, 'locales'), { recursive: true })
    await writeFile(join(dir, 'tsconfig.json'), '{}')
    await writeFile(join(dir, 'x18n.config.yml'), 'typegen:\n  output: types/deep/x18n.d.ts\npresets: [i18next]\nsourceLocale: en\nresources:\n  - pattern: locales/{locale}.json\n')
    await writeFile(join(dir, 'locales/en.json'), '{"a":"A"}\n')
    const connection = client()
    const logs: string[] = []
    connection.onNotification('window/logMessage', (params: { message: string }) => {
      logs.push(params.message)
    })
    await connection.sendRequest(InitializeRequest.type, { processId: null, rootUri: pathToFileURL(dir).href, capabilities: {} })
    await connection.sendNotification('initialized', {})
    await connection.sendRequest(methods.projects)

    const change = async (value: string): Promise<void> => {
      const path = join(dir, 'locales/en.json')
      await writeFile(path, `{"a":${JSON.stringify(value)}}\n`)
      await connection.sendNotification('workspace/didChangeWatchedFiles', {
        changes: [
          { uri: pathToFileURL(path).href, type: 2 },
        ],
      })
    }
    await change('Deep')
    await vi.waitFor(async () => expect(await readFile(join(dir, 'types/deep/x18n.d.ts'), 'utf8')).toContain('"a": "Deep"'), { timeout: 5000, interval: 50 })

    // A file where the folder should be makes the write fail.
    await rm(join(dir, 'types'), { recursive: true })
    await writeFile(join(dir, 'types'), '')
    await change('Blocked')
    await vi.waitFor(() => expect(logs.some(message => message.startsWith('x18n typegen:'))).toBe(true), { timeout: 5000, interval: 50 })
  })
})
