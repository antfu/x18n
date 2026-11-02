import type { MessageConnection } from 'vscode-jsonrpc/node'
import type { InitializeParams, Location, PublishDiagnosticsParams, WorkspaceEdit } from 'vscode-languageserver/node'
import type { ReviewsResult, UnusedDeletionResult } from '../src'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyTextEdits, createLineIndex } from '@x18n/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { createConnection, InitializeRequest, TextDocumentSyncKind } from 'vscode-languageserver/node'
import { version } from '../package.json' with { type: 'json' }
import { methods, setupServer } from '../src'

const fixtures = fileURLToPath(new URL('../../../test/fixtures/', import.meta.url))
let root: string
let client: MessageConnection
const diagnostics = new Map<string, PublishDiagnosticsParams['diagnostics']>()
const disposers: (() => void)[] = []

const posixRelative = (file: string): string => relative(root, file).replace(/\\/g, '/')
const uri = (path: string): string => pathToFileURL(join(root, path)).href

async function text(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8')
}

async function position(path: string, needle: string, delta = 1): Promise<{ line: number, character: number }> {
  const content = await text(path)
  return createLineIndex(content).position(content.indexOf(needle) + delta)
}

function relativeOf(location: Location): string {
  return posixRelative(fileURLToPath(location.uri))
}

async function connect(dir: string, initializationOptions?: InitializeParams['initializationOptions']): Promise<MessageConnection> {
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
  setupServer(server)
  server.listen()
  const connection = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
  connection.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => {
    diagnostics.set(params.uri, params.diagnostics)
  })
  connection.listen()
  disposers.push(() => connection.dispose(), () => server.dispose())
  const params: InitializeParams = {
    processId: null,
    rootUri: pathToFileURL(dir).href,
    capabilities: {},
    initializationOptions,
  }
  const result = await connection.sendRequest(InitializeRequest.type, params)
  expect(result.serverInfo).toEqual({ name: 'x18n', version })
  expect(result.capabilities.textDocumentSync).toBe(TextDocumentSyncKind.Incremental)
  await connection.sendNotification('initialized', {})
  await connection.sendRequest(methods.projects)
  return connection
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'x18n-lsp-'))
  await cp(join(fixtures, 'vue-i18n'), root, { recursive: true })
  client = await connect(root)
})

afterAll(async () => {
  disposers.splice(0).forEach(dispose => dispose())
  await rm(root, { recursive: true, force: true })
})

describe('language server', () => {
  it('lists projects through x18n/projects', async () => {
    const projects: { name: string, locales: { code: string }[] }[] = await client.sendRequest(methods.projects)
    expect(projects[0]!.locales.map(l => l.code)).toEqual(['en', 'de'])
  })

  it('goes to the source-locale entry from a usage', async () => {
    const result: Location[] = await client.sendRequest('textDocument/definition', {
      textDocument: {
        uri: uri('src/App.vue'),
      },
      position: await position('src/App.vue', 'nav.home'),
    })
    expect(result.map(relativeOf)).toEqual(['src/locales/en.json'])
    expect(result[0]!.range.start).toEqual(await position('src/locales/en.json', '"home": "Home"'))
  })

  it('lists every locale entry as implementations', async () => {
    const result: Location[] = await client.sendRequest('textDocument/implementation', {
      textDocument: {
        uri: uri('src/App.vue'),
      },
      position: await position('src/App.vue', 'nav.home'),
    })
    expect(result.map(relativeOf)).toEqual(['src/locales/en.json', 'src/locales/de.json'])
  })

  it('finds references from a resource entry, including prefix usages', async () => {
    const result: Location[] = await client.sendRequest('textDocument/references', {
      textDocument: {
        uri: uri('src/locales/en.json'),
      },
      position: await position('src/locales/en.json', '"home": {', 2),
      context: { includeDeclaration: true },
    })
    expect(result.map(relativeOf)).toContain('src/App.vue')
    expect(result.map(relativeOf).filter(path => path.includes('locales/'))).toEqual([])
  })

  it('returns null from prepareRename outside keys', async () => {
    const result = await client.sendRequest('textDocument/prepareRename', {
      textDocument: {
        uri: uri('src/main.ts'),
      },
      position: { line: 0, character: 3 },
    })
    expect(result).toBeNull()
  })

  it('renames from a usage across locales and code', async () => {
    const pos = await position('src/App.vue', 'nav.home')
    const prepared: { placeholder: string } = await client.sendRequest('textDocument/prepareRename', {
      textDocument: {
        uri: uri('src/App.vue'),
      },
      position: pos,
    })
    expect(prepared.placeholder).toBe('nav.home')
    const edit: WorkspaceEdit = await client.sendRequest('textDocument/rename', {
      textDocument: {
        uri: uri('src/App.vue'),
      },
      position: pos,
      newName: 'nav.start',
    })
    const changed = new Map<string, string>()
    for (const change of edit.documentChanges ?? []) {
      if (!('textDocument' in change))
        continue
      const path = posixRelative(fileURLToPath(change.textDocument.uri))
      const content = await text(path)
      const index = createLineIndex(content)
      changed.set(path, applyTextEdits(content, change.edits.map(e => ({
        range: {
          start: index.offset(e.range.start),
          end: index.offset(e.range.end),
        },
        text: 'newText' in e
          ? e.newText
          : '',
      }))))
    }
    expect([
      ...changed.keys(),
    ].sort()).toEqual(['src/App.vue', 'src/locales/de.json', 'src/locales/en.json'])
    expect(changed.get('src/App.vue')).toContain('t(\'nav.start\')')
    expect(changed.get('src/locales/de.json')).toContain('"start": "Start"')
  })

  it('refuses a rename onto an existing key', async () => {
    const pos = await position('src/App.vue', 'nav.home')
    await expect(client.sendRequest('textDocument/rename', {
      textDocument: {
        uri: uri('src/App.vue'),
      },
      position: pos,
      newName: 'nav.about',
    })).rejects.toThrow(/already exists/)
  })

  it('publishes the diagnostics of x18n check', async () => {
    await expect.poll(() => diagnostics.get(uri('src/App.vue'))?.map(d => d.code)).toEqual(['missing-key'])
    expect(diagnostics.get(uri('src/locales/de.json'))?.map(d => d.code)).toEqual(['placeholder-mismatch', 'empty-translation'])
  })

  it('hovers with values per locale and no command links by default', async () => {
    const hover: { contents: { value: string } } = await client.sendRequest('textDocument/hover', {
      textDocument: {
        uri: uri('src/App.vue'),
      },
      position: await position('src/App.vue', 'app.greeting'),
    })
    expect(hover.contents.value).toContain('| 🇺🇸 en | Hello {name} |')
    expect(hover.contents.value).toMatch(/\d+ usages?$/)
    expect(hover.contents.value).not.toContain('command:')
  })

  it('links only the hover commands the client lists', async () => {
    const editor = await connect(root, {
      hoverCommands: [
        'x18n.openKey',
        'x18n.translateWithAgent',
        'other.command',
        1,
      ],
    })
    const hover: { contents: { value: string } } = await editor.sendRequest('textDocument/hover', {
      textDocument: {
        uri: uri('src/App.vue'),
      },
      position: await position('src/App.vue', 'app.greeting'),
    })
    expect(hover.contents.value).toContain('| 🇺🇸 en | Hello {name} |')
    expect(hover.contents.value).toContain('[Open in UI](command:x18n.openKey?')
    expect(hover.contents.value).toContain('[Translate with agent](command:x18n.translateWithAgent?')
    expect(hover.contents.value).not.toContain('copyTranslatePrompt')
    expect(hover.contents.value).not.toContain('other.command')
  })

  it('completes keys in key slots', async () => {
    const items: { label: string }[] = await client.sendRequest('textDocument/completion', {
      textDocument: {
        uri: uri('src/App.vue'),
      },
      position: await position('src/App.vue', 'nav.home'),
    })
    expect(items.map(i => i.label)).toContain('pages.home.title')
  })

  it('lists the key tree of a resource as document symbols', async () => {
    const symbols: { name: string, children: { name: string }[] }[] = await client.sendRequest('textDocument/documentSymbol', {
      textDocument: {
        uri: uri('src/locales/en.json'),
      },
    })
    expect(symbols.map(s => s.name)).toEqual([
      'app',
      'nav',
      'pages',
      'unused',
      'linked',
    ])
    expect(symbols[0]!.children.map(c => c.name)).toEqual(['title', 'greeting'])
  })

  it('answers x18n/keyAt and x18n/decorations', async () => {
    const keyAt: { key: string, type: string } = await client.sendRequest(methods.keyAt, {
      uri: uri('src/locales/en.json'),
      position: await position('src/locales/en.json', '"pages"', 2),
    })
    expect(keyAt).toMatchObject({ key: 'pages', type: 'subtree' })
    const result: { decorations: { key: string, state: string, expression?: { start: unknown, end: unknown } }[] } = await client.sendRequest(methods.decorations, {
      uri: uri('src/App.vue'),
    })
    expect(result.decorations.map(d => `${d.key}:${d.state}`)).toContain('app.titel:missing')
    expect(result.decorations.find(d => d.key === 'app.greeting')?.expression).toEqual({ start: await position('src/App.vue', '$t(\'app.greeting', 0), end: await position('src/App.vue', ') }}</h1>') })
    expect(result.decorations.find(d => d.key === 'nav.about')?.expression).toBeUndefined()
  })

  it('finds keys by value with their usages through x18n/search', async () => {
    const matches: { key: string, locale: string, value: string, definition: Location, usages: Location[] }[] = await client.sendRequest(methods.search, { query: 'WILLKOMMEN', exact: true })
    expect(matches.map(m => [m.key, m.locale, m.value])).toEqual([
      ['pages.home.title', 'de', 'Willkommen'],
    ])
    expect(relativeOf(matches[0]!.definition)).toBe('src/locales/de.json')
    expect(matches[0]!.definition.range.start).toEqual(await position('src/locales/de.json', '"title": "Willkommen"'))
    const [app]: typeof matches = await client.sendRequest(methods.search, { query: 'mapp' })
    expect(app).toMatchObject({ key: 'app.title', locale: 'en' })
    expect(app!.usages.map(relativeOf)).toEqual(['src/App.vue'])
    expect(await client.sendRequest(methods.search, { query: '' })).toEqual([])
  })

  it('plans the bulk delete of unused keys and applies it as one workspace edit', async () => {
    const plan: UnusedDeletionResult = await client.sendRequest(methods.unusedDeletion, {})
    const [project] = plan.projects
    expect(project!.keys.map(k => k.key)).toEqual(['linked', 'unused'])
    expect(project!.keys[1]!.locations.map(relativeOf)).toEqual(['src/locales/en.json', 'src/locales/de.json'])
    expect(project!.kept).toEqual([])
    const applied: WorkspaceEdit[] = []
    const handler = client.onRequest('workspace/applyEdit', (params: { edit: WorkspaceEdit }) => {
      applied.push(params.edit)
      return { applied: true }
    })
    try {
      const edit: WorkspaceEdit = await client.sendRequest('workspace/executeCommand', { command: 'x18n.deleteUnused', arguments: [] })
      expect(applied).toEqual([edit])
      const paths = (edit.documentChanges ?? []).flatMap(change => 'textDocument' in change
        ? [
            posixRelative(fileURLToPath(change.textDocument.uri)),
          ]
        : [])
      expect(paths.sort()).toEqual(['src/locales/de.json', 'src/locales/en.json'])
    }
    finally {
      handler.dispose()
    }
    // The client applied nothing to disk.
    expect(await text('src/locales/en.json')).toContain('"unused"')
  })

  it('sorts the usage report', async () => {
    const report: { unused: { key: string }[], missing: { key: string }[] } = await client.sendRequest(methods.usageReport)
    const keys = report.unused.map(u => u.key)
    expect(keys).toEqual([...keys].sort())
  })

  it('re-scans an open document on change', async () => {
    const content = await text('src/main.ts')
    await client.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: uri('src/main.ts'),
        languageId: 'typescript',
        version: 1,
        text: content,
      },
    })
    await client.sendNotification('textDocument/didChange', {
      textDocument: {
        uri: uri('src/main.ts'),
        version: 2,
      },
      contentChanges: [
        { text: `${content}\ni18n.global.t('brand.new')\n` },
      ],
    })
    await expect.poll(() => diagnostics.get(uri('src/main.ts'))?.map(d => d.message), { timeout: 3000 }).toEqual(['"brand.new" is not defined in en.'])
  })

  // Last: `shutdown` stops the UI server.
  it('adds, lists and resolves reviews, with their diagnostic and hover', async () => {
    await client.sendRequest('workspace/executeCommand', {
      command: 'x18n.review',
      arguments: [
        {
          key: 'app.greeting',
          locale: 'de',
          review: 'request-change',
          text: 'Use "Servus"',
        },
      ],
    })
    const { threads } = await client.sendRequest(methods.reviews, { open: true }) as ReviewsResult
    expect(threads).toMatchObject([
      {
        key: 'app.greeting',
        locale: 'de',
        state: 'changes-requested',
        comments: [
          { type: 'request-change', text: 'Use "Servus"' },
        ],
      },
    ])
    expect(relativeOf(threads[0]!.location!)).toBe('src/locales/de.json')
    await expect.poll(() => diagnostics.get(uri('src/locales/de.json'))?.map(d => d.code)).toContain('review-changes-requested')
    const hover: { contents: { value: string } } = await client.sendRequest('textDocument/hover', {
      textDocument: {
        uri: uri('src/App.vue'),
      },
      position: await position('src/App.vue', 'app.greeting'),
    })
    expect(hover.contents.value).toContain('**Reviews** de: changes requested')
    await client.sendRequest('workspace/executeCommand', {
      command: 'x18n.resolveReview',
      arguments: [
        { id: threads[0]!.comments[0]!.id },
      ],
    })
    expect((await client.sendRequest(methods.reviews, { open: true }) as ReviewsResult).threads).toEqual([])
    expect(await text('.x18n/reviews.yml')).toContain('resolved: true')
    await expect.poll(() => diagnostics.get(uri('src/locales/de.json'))?.map(d => d.code)).toEqual(['placeholder-mismatch', 'empty-translation'])
  })

  it('starts the UI on loopback with a one-time code, reuses it, and stops it on shutdown', async () => {
    const opened: { url: string, token: string } = await client.sendRequest(methods.openUi, {})
    expect(opened.url).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):\d+\/$/)
    expect(opened.token).toMatch(/^\d{6}$/)
    expect((await client.sendRequest<{ url: string }>(methods.openUi, {})).url).toBe(opened.url)
    expect(await (await fetch(`${opened.url}__connection.json`)).json()).toMatchObject({ backend: 'websocket' })
    await client.sendRequest('shutdown')
    await expect(fetch(`${opened.url}__connection.json`)).rejects.toThrow()
  })
})

describe('completion with namespaces', () => {
  it('writes the configured separator and leaves out fallback namespaces', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'x18n-lsp-ns-'))
    const files: Record<string, object | string> = {
      'x18n.config.json': {
        resources: [
          { pattern: 'locales/{locale}/{namespace}.json' },
        ],
        namespace: {
          separator: '|',
          fallback: ['common'],
        },
        usage: {
          calls: [
            {
              callee: 'useTranslation',
              factory: true,
              namespace: { arg: 0 },
            },
          ],
        },
      },
      'locales/en/event.json': { name: 'Name', save: 'Save event' },
      'locales/en/common.json': { save: 'Save', delete: 'Delete' },
      'locales/en/other.json': { x: 'X' },
      'src/a.ts': `const { t } = useTranslation('event')\nt('')\n`,
    }
    try {
      for (const [path, content] of Object.entries(files)) {
        await mkdir(join(dir, path, '..'), { recursive: true })
        await writeFile(join(dir, path), typeof content === 'string'
          ? content
          : JSON.stringify(content))
      }
      const connection = await connect(dir)
      const content = await readFile(join(dir, 'src/a.ts'), 'utf8')
      const items: { label: string }[] = await connection.sendRequest('textDocument/completion', {
        textDocument: { uri: pathToFileURL(join(dir, 'src/a.ts')).href },
        position: createLineIndex(content).position(content.indexOf(`t('')`) + 3),
      })
      expect(items.map(i => i.label).sort()).toEqual([
        'common|save',
        'delete',
        'name',
        'other|x',
        'save',
      ])
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('x18n-lsp binary', () => {
  it('answers initialize over stdio', async () => {
    const { spawn } = await import('node:child_process')
    const child = spawn(process.execPath, [
      fileURLToPath(new URL('../bin.mjs', import.meta.url)),
      '--stdio',
    ], { stdio: 'pipe' })
    const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin))
    connection.listen()
    const result = await connection.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
    expect(result.serverInfo?.name).toBe('x18n')
    connection.dispose()
    child.kill()
  })
})
