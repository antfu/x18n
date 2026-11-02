import type { MessageConnection } from 'vscode-jsonrpc/node'
import type { InlayHint } from 'vscode-languageserver/node'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { createLineIndex } from '@x18n/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { createConnection, InitializeRequest } from 'vscode-languageserver/node'
import { methods, setupServer } from '../src'

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0))
    await cleanup()
})

async function open(files: Record<string, string>): Promise<{ client: MessageConnection, uri: (path: string) => string }> {
  const root = await mkdtemp(join(tmpdir(), 'x18n-annotations-'))
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
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: pathToFileURL(root).href, capabilities: {} })
  await client.sendNotification('initialized', {})
  await client.sendRequest(methods.projects)
  return {
    client,
    uri: path => pathToFileURL(join(root, path)).href,
  }
}

/** The hints of a whole text, each as the text before it on its line and its label. */
async function hints(client: MessageConnection, uri: string, text: string): Promise<{ after: string, label: string }[]> {
  const index = createLineIndex(text)
  const found: InlayHint[] = await client.sendRequest('textDocument/inlayHint', {
    textDocument: { uri },
    range: {
      start: { line: 0, character: 0 },
      end: index.position(text.length),
    },
  })
  return found.map(hint => ({
    after: text.slice(0, index.offset(hint.position)).split('\n').at(-1)!.trimStart(),
    label: String(hint.label).trim(),
  }))
}

function i18next(messages: object): Record<string, string> {
  return {
    'package.json': JSON.stringify({
      dependencies: { i18next: '*' },
    }),
    'locales/en.json': JSON.stringify(messages),
  }
}

describe('annotation placement', () => {
  it('follows the key in a call over several lines', async () => {
    const text = 'import { t } from \'i18next\'\nt(\n  \'common.foo\'\n)\nt(\n  \'common.bar\',\n  { name: 1 },\n)\n'
    const { client, uri } = await open({
      ...i18next({
        common: { foo: 'Foo', bar: 'Bar' },
      }),
      'src/a.ts': text,
    })
    expect(await hints(client, uri('src/a.ts'), text)).toEqual([
      { after: '\'common.foo\'', label: 'Foo' },
      { after: '\'common.bar\'', label: 'Bar' },
    ])
  })

  it('follows the key in a line broken by Prettier inside JSX', async () => {
    const text = 'import { useTranslation } from \'react-i18next\'\nexport function A() {\n  const { t } = useTranslation()\n  return (\n    <p>\n      {t(\n        \'long.key\',\n      )}\n    </p>\n  )\n}\n'
    const { client, uri } = await open({
      'package.json': JSON.stringify({
        dependencies: { 'i18next': '*', 'react-i18next': '*' },
      }),
      'locales/en.json': JSON.stringify({
        long: { key: 'Long' },
      }),
      'src/a.tsx': text,
    })
    expect(await hints(client, uri('src/a.tsx'), text)).toEqual([
      { after: '\'long.key\'', label: 'Long' },
    ])
  })

  it('follows the key over several lines in Svelte and Vue', async () => {
    const svelte = '<script>\n  import { _ } from \'svelte-i18n\'\n</script>\n\n<p>{$_(\n  \'hello.a\'\n)}</p>\n'
    const vue = '<template>\n  <p>{{ $t(\n    \'hello.b\'\n  ) }}</p>\n</template>\n'
    const { client, uri } = await open({
      'package.json': JSON.stringify({
        dependencies: { 'svelte-i18n': '*', 'vue-i18n': '*' },
      }),
      'locales/en.json': JSON.stringify({
        hello: { a: 'A', b: 'B' },
      }),
      'src/a.svelte': svelte,
      'src/b.vue': vue,
    })
    expect(await hints(client, uri('src/a.svelte'), svelte)).toEqual([
      { after: '\'hello.a\'', label: 'A' },
    ])
    expect(await hints(client, uri('src/b.vue'), vue)).toEqual([
      { after: '\'hello.b\'', label: 'B' },
    ])
  })

  it('keeps its place after an emoji, wide text and CRLF line ends', async () => {
    const text = 'import { t } from \'i18next\'\r\nconst a = \'🌯🌯 日本語\'; t(\'x.y\')\r\nt(\'x.z\')\r\n'
    const { client, uri } = await open({
      ...i18next({
        x: { y: 'Y', z: 'Z' },
      }),
      'src/a.ts': text,
    })
    expect(await hints(client, uri('src/a.ts'), text)).toEqual([
      { after: 'const a = \'🌯🌯 日本語\'; t(\'x.y\'', label: 'Y' },
      { after: 't(\'x.z\'', label: 'Z' },
    ])
  })

  it('keeps calls next to each other apart', async () => {
    const text = 'import { t } from \'i18next\'\nconst a = [t(\'k.a\'), t(\'k.b\'), t(t(\'k.c\'))]\n'
    const { client, uri } = await open({
      ...i18next({
        k: { a: 'A', b: 'B', c: 'C' },
      }),
      'src/a.ts': text,
    })
    expect(await hints(client, uri('src/a.ts'), text)).toEqual([
      { after: 'const a = [t(\'k.a\'', label: 'A' },
      { after: 'const a = [t(\'k.a\'), t(\'k.b\'', label: 'B' },
      { after: 'const a = [t(\'k.a\'), t(\'k.b\'), t(t(\'k.c\'', label: 'C' },
    ])
  })

  it('stays on the key right after an edit, before the rescan', async () => {
    const text = 'import { t } from \'i18next\'\nt(\'k.a\')\n'
    const { client, uri } = await open({
      ...i18next({
        k: { a: 'A' },
      }),
      'src/a.ts': text,
    })
    await client.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: uri('src/a.ts'),
        languageId: 'typescript',
        version: 1,
        text,
      },
    })
    const edited = `// a new line\n// and another\n${text}`
    await client.sendNotification('textDocument/didChange', {
      textDocument: {
        uri: uri('src/a.ts'),
        version: 2,
      },
      contentChanges: [
        { text: edited },
      ],
    })
    expect(await hints(client, uri('src/a.ts'), edited)).toEqual([
      { after: 't(\'k.a\'', label: 'A' },
    ])
    await expect.poll(() => hints(client, uri('src/a.ts'), edited), { timeout: 3000 }).toEqual([
      { after: 't(\'k.a\'', label: 'A' },
    ])
  })

  it('shows a value with a line break on one line', async () => {
    const text = 'import { t } from \'i18next\'\nt(\'k.a\')\n'
    const { client, uri } = await open({
      ...i18next({
        k: { a: 'first line\nsecond line' },
      }),
      'src/a.ts': text,
    })
    expect((await hints(client, uri('src/a.ts'), text)).map(h => h.label)).toEqual(['first line second line'])
  })

  it('never cuts an emoji in half when shortening', async () => {
    const text = 'import { t } from \'i18next\'\nt(\'k.a\')\n'
    const { client, uri } = await open({
      ...i18next({
        k: { a: `${'a'.repeat(38)}🌯🌯🌯` },
      }),
      'src/a.ts': text,
    })
    const [hint] = await hints(client, uri('src/a.ts'), text)
    expect(hint!.label).toBe(`${'a'.repeat(38)}…`)
  })
})

describe('annotation placement in Angular templates', () => {
  const ngx = {
    'package.json': JSON.stringify({
      dependencies: { '@angular/core': '*', '@ngx-translate/core': '*' },
    }),
    'src/assets/i18n/en.json': JSON.stringify({ a: 'A', b: 'B', c: 'C' }),
  }

  it('follows the key in pipes over several lines, ternaries and directives', async () => {
    const text = '<p>{{\n  \'a\'\n    | translate\n}}</p>\n<p [title]="\'b\' | translate"></p>\n<p translate>c</p>\n'
    const { client, uri } = await open({ ...ngx, 'src/app/a.html': text })
    expect(await hints(client, uri('src/app/a.html'), text)).toEqual([
      { after: '\'a\'', label: 'A' },
      { after: '<p [title]="\'b\'', label: 'B' },
      { after: '<p translate>c', label: 'C' },
    ])
  })

  it('follows ids in i18n attributes over several lines', async () => {
    const text = '<p\n  class="x"\n  i18n="@@a.b"\n>Hello</p>\n<img i18n-alt="@@a.c" alt="Cat">\n'
    const { client, uri } = await open({
      'package.json': JSON.stringify({
        dependencies: { '@angular/core': '*', '@angular/localize': '*' },
      }),
      'angular.json': JSON.stringify({
        projects: {
          app: {
            i18n: {
              sourceLocale: 'en',
              locales: { tr: 'src/locale/messages.tr.json' },
            },
            architect: {
              'extract-i18n': {
                options: { format: 'json', outputPath: 'src/locale' },
              },
            },
          },
        },
      }),
      'src/locale/messages.json': JSON.stringify({
        locale: 'en',
        translations: { 'a.b': 'Hello', 'a.c': 'Cat' },
      }),
      'src/locale/messages.tr.json': JSON.stringify({
        locale: 'tr',
        translations: { 'a.b': 'Merhaba', 'a.c': 'Kedi' },
      }),
      'src/app/a.html': text,
    })
    const found = await hints(client, uri('src/app/a.html'), text)
    expect(found.map(h => h.label)).toEqual(['Hello', 'Cat'])
    expect(found.map(h => h.after)).toEqual(['i18n="@@a.b"', '<img i18n-alt="@@a.c"'])
  })
})
