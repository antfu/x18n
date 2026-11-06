import type { Location, Position, WorkspaceEdit } from 'vscode'
import type { X18nExtensionApi } from '../../src/index'
import { deepStrictEqual, ok } from 'node:assert/strict'
import { commands, ConfigurationTarget, extensions, Range, TabInputWebview, Uri, window, workspace } from 'vscode'

async function until<T>(what: string, probe: () => Promise<T | undefined> | T | undefined, timeout = 30_000): Promise<T> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await probe()
    if (value !== undefined)
      return value
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`timed out waiting for ${what}`)
}

function folder(): Uri {
  const [first] = workspace.workspaceFolders ?? []
  ok(first, 'a workspace folder is open')
  return first.uri
}
const file = (path: string): Uri => Uri.joinPath(folder(), path)
const relative = (uri: Uri): string => uri.path.slice(folder().path.length + 1)

async function positionOf(uri: Uri, text: string): Promise<Position> {
  const document = await workspace.openTextDocument(uri)
  return document.positionAt(document.getText().indexOf(text) + 1)
}

const tests: [string, (api: X18nExtensionApi) => Promise<void>][] = [
  [
    'shows an in-place value for a key',
    async (api) => {
      const uri = file('src/App.vue')
      await window.showTextDocument(uri)
      const replaced = await until('in-place decorations', () => {
        const texts = api.inPlace(uri.toString()).replaced.map(r => r.text)
        return texts.includes('My App')
          ? texts
          : undefined
      })
      ok(replaced.includes('Hello x'))
    },
  ],
  [
    'replaces the whole call with full match',
    async (api) => {
      const uri = file('src/App.vue')
      const settings = workspace.getConfiguration('x18n')
      await settings.update('annotationInPlaceFullMatch', true, ConfigurationTarget.Global)
      try {
        const document = await workspace.openTextDocument(uri)
        const greeting = await until('a full-match replacement', () => api.inPlace(uri.toString()).replaced.find(r => r.fullMatch && r.text === 'Hello x'))
        const { start, end } = greeting.range
        deepStrictEqual(document.getText(new Range(start.line, start.character, end.line, end.character)), `$t('app.greeting', { name: 'x' })`)
      }
      finally {
        await settings.update('annotationInPlaceFullMatch', undefined, ConfigurationTarget.Global)
      }
    },
  ],
  [
    'renames a typed key literal through x18n',
    async () => {
      const uri = file('src/typed.ts')
      await window.showTextDocument(uri)
      const position = await positionOf(uri, '\'app.title\')')
      const edit = await until('a rename edit', async () => {
        const result = await commands.executeCommand<WorkspaceEdit | undefined>('vscode.executeDocumentRenameProvider', uri, position, 'app.heading')
        return result?.entries().some(([u]) => relative(u) === 'src/locales/en.json')
          ? result
          : undefined
      })
      ok(extensions.getExtension('vscode.typescript-language-features')?.isActive, 'tsserver is active')
      const files = edit.entries().map(([u]) => relative(u)).sort()
      ok(files.includes('src/locales/de.json'), files.join(', '))
      ok(files.includes('src/App.vue'), files.join(', '))
    },
  ],
  [
    'lists references without duplicates',
    async () => {
      const uri = file('src/App.vue')
      const position = await positionOf(uri, '\'app.title\'')
      const locations = await commands.executeCommand<Location[]>('vscode.executeReferenceProvider', uri, position)
      const ids = locations.map(l => `${relative(l.uri)}:${l.range.start.line}:${l.range.start.character}`)
      deepStrictEqual(ids, [
        ...new Set(ids),
      ])
      ok(ids.some(id => id.startsWith('src/locales/en.json')), ids.join(', '))
    },
  ],
  [
    'opens the UI panel',
    async () => {
      await commands.executeCommand('x18n.openUi')
      await until('the UI webview tab', () => window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof TabInputWebview && t.input.viewType.endsWith('x18n.ui')))
    },
  ],
]

export async function run(): Promise<void> {
  const extension = extensions.getExtension<X18nExtensionApi>('antfu.x18n-vscode')
  ok(extension, 'extension installed')
  const api = await extension.activate()
  ok(extension.isActive, 'extension activated')
  const failures: string[] = []
  for (const [name, test] of tests) {
    try {
      await Promise.race([
        test(api),
        new Promise((_, reject) => setTimeout(reject, 90_000, new Error('test timed out'))),
      ])
      console.error(`  ✓ ${name}`)
    }
    catch (error) {
      console.error(`  ✗ ${name}\n    ${error instanceof Error
        ? error.message
        : String(error)}`)
      failures.push(name)
    }
  }
  if (failures.length)
    throw new Error(`${failures.length} e2e test(s) failed: ${failures.join('; ')}`)
}
