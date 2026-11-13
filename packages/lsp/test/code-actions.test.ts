import type { MessageConnection } from 'vscode-jsonrpc/node'
import type { CodeAction, InitializeParams } from 'vscode-languageserver/node'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { createLineIndex } from '@x18n/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { createConnection, InitializeRequest } from 'vscode-languageserver/node'
import { setupServer } from '../src'

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0))
    await cleanup()
})

async function open(files: Record<string, string>, initializationOptions?: InitializeParams['initializationOptions']): Promise<{ client: MessageConnection, uri: (path: string) => string }> {
  const root = await mkdtemp(join(tmpdir(), 'x18n-inline-actions-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
  setupServer(server)
  server.listen()
  const client = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
  client.listen()
  cleanups.push(() => client.dispose(), () => server.dispose())
  await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: pathToFileURL(root).href,
    capabilities: {},
    initializationOptions,
  })
  await client.sendNotification('initialized', {})
  await client.sendRequest('x18n/projects')
  return {
    client,
    uri: path => pathToFileURL(join(root, path)).href,
  }
}

async function inlineActions(client: MessageConnection, uri: string, text: string, at: number, end = at): Promise<CodeAction[]> {
  const index = createLineIndex(text)
  const found: CodeAction[] = await client.sendRequest('textDocument/codeAction', {
    textDocument: { uri },
    range: {
      start: index.position(at),
      end: index.position(end),
    },
    context: { diagnostics: [] },
  })
  return found.filter(action => action.kind === 'refactor.inline')
}

function editOf(action: CodeAction, uri: string): { range: unknown, newText: string } {
  return action.edit!.changes![uri]![0] as { range: unknown, newText: string }
}

describe('inline code action', () => {
  it('replaces a static call in TypeScript and skips other calls', async () => {
    const text = [
      'import { t } from \'i18next\'',
      'const a = t(\'hello.world\')',
      'const b = t(\'hello.world\', { name: \'Ada\' })',
      'const c = t(someKey)',
      'const d = t(\'num\')',
      'const e = t(\'missing\')',
      '',
    ].join('\n')
    const { client, uri } = await open({
      'package.json': JSON.stringify({
        dependencies: { i18next: '*' },
      }),
      'locales/en.json': JSON.stringify({
        hello: { world: 'Hello world' },
        num: 1,
      }),
      'src/a.ts': text,
    })
    const url = uri('src/a.ts')
    const at = (needle: string): number => text.indexOf(needle)

    const [action] = await inlineActions(client, url, text, at('t(\'hello.world\')') + 2)
    expect(action?.title).toBe('Inline "Hello world" (en)')
    expect(editOf(action!, url)).toEqual({
      range: {
        start: { line: 1, character: 10 },
        end: { line: 1, character: 26 },
      },
      newText: '"Hello world"',
    })

    expect(await inlineActions(client, url, text, at('t(\'hello.world\',') + 2)).toEqual([])
    expect(await inlineActions(client, url, text, at('t(someKey)') + 2)).toEqual([])
    expect(await inlineActions(client, url, text, at('t(\'num\')') + 2)).toEqual([])
    expect(await inlineActions(client, url, text, at('t(\'missing\')') + 2)).toEqual([])
  })

  it('inlines a call broken over lines with a trailing comma', async () => {
    const text = [
      'import { t } from \'i18next\'',
      'const a = t(',
      '  \'hello.world\',',
      ')',
      '',
    ].join('\n')
    const { client, uri } = await open({
      'package.json': JSON.stringify({
        dependencies: { i18next: '*' },
      }),
      'locales/en.json': JSON.stringify({
        hello: { world: 'Hello world' },
      }),
      'src/a.ts': text,
    })
    const url = uri('src/a.ts')
    const [action] = await inlineActions(client, url, text, text.indexOf('hello.world') + 2)
    expect(editOf(action!, url)).toEqual({
      range: {
        start: { line: 1, character: 10 },
        end: { line: 3, character: 1 },
      },
      newText: '"Hello world"',
    })
  })

  it('uses the display locale', async () => {
    const text = 'import { t } from \'i18next\'\nconst a = t(\'hello\')\n'
    const { client, uri } = await open({
      'package.json': JSON.stringify({
        dependencies: { i18next: '*' },
      }),
      'locales/en.json': JSON.stringify({ hello: 'Hello' }),
      'locales/zh.json': JSON.stringify({ hello: '你好' }),
      'src/a.ts': text,
    }, { displayLocale: 'zh' })
    const [action] = await inlineActions(client, uri('src/a.ts'), text, text.indexOf('t(\'hello\')') + 2)
    expect(action?.title).toBe('Inline "你好" (zh)')
    expect(editOf(action!, uri('src/a.ts')).newText).toBe('"你好"')
  })

  it('quotes a Vue directive and a Vue interpolation', async () => {
    const text = '<template>\n  <a :title="$t(\'nav.docs\')">x</a>\n  <p>{{ $t(\'nav.docs\') }}</p>\n</template>\n'
    const { client, uri } = await open({
      'package.json': JSON.stringify({
        dependencies: { 'vue-i18n': '*' },
      }),
      'locales/en.json': JSON.stringify({
        nav: {
          docs: 'Docs & more',
        },
      }),
      'src/a.vue': text,
    })
    const url = uri('src/a.vue')

    const [directive] = await inlineActions(client, url, text, text.indexOf('$t(\'nav.docs\')') + 2)
    expect(editOf(directive!, url)).toEqual({
      range: {
        start: { line: 1, character: 13 },
        end: { line: 1, character: 27 },
      },
      newText: '\'Docs &amp; more\'',
    })

    const interpolationAt = text.lastIndexOf('$t(\'nav.docs\')') + 2
    const [interpolation] = await inlineActions(client, url, text, interpolationAt)
    expect(editOf(interpolation!, url).newText).toBe('"Docs & more"')
  })

  it('inlines the decoded text of a vue-i18n literal and skips a value it cannot decode', async () => {
    const text = [
      '<template>',
      '  <p>{{ $t(\'mail\') }}</p>',
      '  <p>{{ $t(\'linked\') }}</p>',
      '  <p>{{ $t(\'param\') }}</p>',
      '  <p>{{ $t(\'plural\') }}</p>',
      '</template>',
      '',
    ].join('\n')
    const { client, uri } = await open({
      'package.json': JSON.stringify({
        dependencies: { 'vue-i18n': '*' },
      }),
      'locales/en.json': JSON.stringify({
        mail: 'hello{\'@\'}example.com',
        linked: '@:mail',
        param: 'hi {name}',
        plural: 'one | other',
      }),
      'src/a.vue': text,
    })
    const url = uri('src/a.vue')

    const [mail] = await inlineActions(client, url, text, text.indexOf('$t(\'mail\')') + 2)
    expect(mail?.title).toBe('Inline "hello@example.com" (en)')
    expect(editOf(mail!, url).newText).toBe('"hello@example.com"')

    for (const key of ['linked', 'param', 'plural'])
      expect(await inlineActions(client, url, text, text.indexOf(`$t('${key}')`) + 2)).toEqual([])
  })
})

/**
 * Every call shape the inline action accepts or refuses, in one table: `title` is the action's title
 * when it is offered, `newText` the literal it writes, and `null` means no action.
 */
interface InlineCase {
  readonly label: string
  readonly file: string
  readonly needle: string
  readonly title: string | null
  readonly newText?: string
}

const messages = {
  plain: 'Plain',
  literal: 'hello{\'@\'}example.com',
  param: 'Hello {name}',
  plural: 'one | other',
  linked: '@:plain',
  brace: 'a{b',
  empty: '',
  num: 3,
  scriptGuard: 'a </script> b',
  interpolationGuard: 'a }} b',
}

const tsSource = [
  'import { useI18n } from \'vue-i18n\'',
  '',
  'const { t } = useI18n()',
  'const KEY = \'plain\'',
  'const a = t(\'plain\')',
  'const b = t(`plain`)',
  'const c = t(\'plain\',)',
  'const d = t(',
  '  \'plain\',',
  ')',
  'const e = t(\'plain\') + \'!\'',
  // eslint-disable-next-line no-template-curly-in-string -- the fixture is a template literal
  'const f = `${t(\'plain\')}`',
  'const g = String(t(\'plain\'))',
  'const h = t(\'plain\', { name: \'Ada\' })',
  'const i = t(\'param\')',
  'const j = t(\'plural\')',
  'const k = t(\'linked\')',
  'const l = t(\'brace\')',
  'const m = t(\'missing\')',
  'const n = t(KEY)',
  // eslint-disable-next-line no-template-curly-in-string -- the fixture is a computed key
  'const o = t(`ns.${KEY}`)',
  'const p = t(\'empty\')',
  'const q = t(\'num\')',
  'const r = t(\'scriptGuard\')',
  'const u = t(\'literal\')',
  '',
].join('\n')

const vueSource = [
  '<script setup lang="ts">',
  'const a = $t(\'plain\')',
  'const b = $t(\'scriptGuard\')',
  '</script>',
  '',
  '<template>',
  '  <p>{{ $t(\'plain\') }}</p>',
  '  <p>{{ $t(\'plain\',) }}</p>',
  '  <p>{{ $t(\'plain\') + \'!\' }}</p>',
  '  <p>{{ $t(\'interpolationGuard\') }}</p>',
  '  <div :title="$t(\'plain\')" />',
  '  <div v-t="\'plain\'" />',
  '</template>',
  '',
].join('\n')

const cases: readonly InlineCase[] = [
  // A quoted key, in a script, at any place in the expression.
  {
    label: 'script: bare call',
    file: 'src/a.ts',
    needle: 't(\'plain\')',
    title: 'Inline "Plain" (en)',
    newText: '"Plain"',
  },
  {
    label: 'script: template-literal key',
    file: 'src/a.ts',
    needle: 't(`plain`)',
    title: 'Inline "Plain" (en)',
    newText: '"Plain"',
  },
  {
    label: 'script: trailing comma',
    file: 'src/a.ts',
    needle: 't(\'plain\',)',
    title: 'Inline "Plain" (en)',
  },
  {
    label: 'script: multiline with trailing comma',
    file: 'src/a.ts',
    needle: 't(\n  \'plain\',\n)',
    title: 'Inline "Plain" (en)',
  },
  {
    label: 'script: inside a larger expression',
    file: 'src/a.ts',
    needle: 't(\'plain\') + \'!\'',
    title: 'Inline "Plain" (en)',
  },
  {
    label: 'script: inside a template literal',
    file: 'src/a.ts',
    // eslint-disable-next-line no-template-curly-in-string -- the case is a template literal
    needle: '`${t(\'plain\')}`',
    title: 'Inline "Plain" (en)',
  },
  {
    label: 'script: inside a call argument',
    file: 'src/a.ts',
    needle: 'String(t(\'plain\'))',
    title: 'Inline "Plain" (en)',
  },
  // The value decides, not the call shape.
  {
    label: 'value: literal decoded',
    file: 'src/a.ts',
    needle: 't(\'literal\')',
    title: 'Inline "hello@example.com" (en)',
    newText: '"hello@example.com"',
  },
  {
    label: 'value: text a `<script>` would close',
    file: 'src/a.ts',
    needle: 't(\'scriptGuard\')',
    title: 'Inline "a </script> b" (en)',
    newText: '"a </script> b"',
  },
  // Refused: the text needs runtime input or the syntax is not text.
  {
    label: 'value: param',
    file: 'src/a.ts',
    needle: 't(\'param\')',
    title: null,
  },
  {
    label: 'value: plural list',
    file: 'src/a.ts',
    needle: 't(\'plural\')',
    title: null,
  },
  {
    label: 'value: linked message',
    file: 'src/a.ts',
    needle: 't(\'linked\')',
    title: null,
  },
  {
    label: 'value: bare brace',
    file: 'src/a.ts',
    needle: 't(\'brace\')',
    title: null,
  },
  {
    label: 'value: empty',
    file: 'src/a.ts',
    needle: 't(\'empty\')',
    title: null,
  },
  {
    label: 'value: not a string',
    file: 'src/a.ts',
    needle: 't(\'num\')',
    title: null,
  },
  {
    label: 'value: missing in the display locale',
    file: 'src/a.ts',
    needle: 't(\'missing\')',
    title: null,
  },
  // Refused: the call shape.
  {
    label: 'call: argument after the key',
    file: 'src/a.ts',
    needle: 't(\'plain\', { name: \'Ada\' })',
    title: null,
  },
  {
    label: 'call: constant key',
    file: 'src/a.ts',
    needle: 't(KEY)',
    title: null,
  },
  {
    label: 'call: computed template key',
    file: 'src/a.ts',
    // eslint-disable-next-line no-template-curly-in-string -- the case is a computed key
    needle: 't(`ns.${KEY}`)',
    title: null,
  },
  // A Vue SFC: the script behaves like a script, the template is stricter.
  {
    label: 'vue script: bare call',
    file: 'src/b.vue',
    needle: '$t(\'plain\')',
    title: 'Inline "Plain" (en)',
    newText: '"Plain"',
  },
  {
    label: 'vue script: text a `<script>` would close',
    file: 'src/b.vue',
    needle: '$t(\'scriptGuard\')',
    title: null,
  },
  {
    label: 'vue interpolation: the whole expression',
    file: 'src/b.vue',
    needle: '{{ $t(\'plain\') }}',
    title: 'Inline "Plain" (en)',
    newText: '"Plain"',
  },
  {
    label: 'vue interpolation: trailing comma',
    file: 'src/b.vue',
    needle: '{{ $t(\'plain\',) }}',
    title: 'Inline "Plain" (en)',
  },
  {
    label: 'vue interpolation: part of a larger expression',
    file: 'src/b.vue',
    needle: '{{ $t(\'plain\') + \'!\' }}',
    title: null,
  },
  {
    label: 'vue interpolation: text the syntax reserves',
    file: 'src/b.vue',
    needle: '{{ $t(\'interpolationGuard\') }}',
    title: null,
  },
  {
    label: 'vue attribute: the whole quoted value',
    file: 'src/b.vue',
    needle: ':title="$t(\'plain\')"',
    title: 'Inline "Plain" (en)',
    newText: '\'Plain\'',
  },
  {
    label: 'vue directive: no call to replace',
    file: 'src/b.vue',
    needle: 'v-t="\'plain\'"',
    title: null,
  },
]

describe('inline cases', () => {
  it('offers the action exactly on the calls whose text it can prove', async () => {
    const { client, uri } = await open({
      'package.json': JSON.stringify({
        dependencies: { 'vue-i18n': '*' },
      }),
      'locales/en.json': JSON.stringify(messages),
      'src/a.ts': tsSource,
      'src/b.vue': vueSource,
    })
    const sources = new Map([
      [
        'src/a.ts',
        tsSource,
      ],
      [
        'src/b.vue',
        vueSource,
      ],
    ])
    const mismatches: string[] = []
    for (const scenario of cases) {
      const text = sources.get(scenario.file)!
      const at = text.indexOf(scenario.needle)
      if (at === -1) {
        mismatches.push(`${scenario.label}: \`${scenario.needle}\` is not in ${scenario.file}`)
        continue
      }
      const [action] = await inlineActions(client, uri(scenario.file), text, at, at + scenario.needle.length)
      const title = action?.title ?? null
      if (title !== scenario.title) {
        mismatches.push(`${scenario.label}: expected ${scenario.title === null
          ? 'no action'
          : scenario.title}, got ${title === null
          ? 'no action'
          : title}`)
        continue
      }
      if (action && scenario.newText !== undefined) {
        const { newText } = editOf(action, uri(scenario.file))
        if (newText !== scenario.newText)
          mismatches.push(`${scenario.label}: expected newText ${scenario.newText}, got ${newText}`)
      }
    }
    expect(mismatches).toEqual([])
  })
})
