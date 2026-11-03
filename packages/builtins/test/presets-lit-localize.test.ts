import { describe, expect, it } from 'vitest'
import { litLocalize } from '../src/presets/lit-localize'
import { messageId } from '../src/presets/lit-localize/message-id'
import { createTestProject, json } from './_utils'

function unit(id: string, source: string, target?: string): string {
  return `<trans-unit id="${id}"><source>${source}</source>${target
    ? `<target>${target}</target>`
    : ''}</trans-unit>`
}
const xlf = (locale: string, units: string): string => `<?xml version="1.0"?>\n<xliff version="1.2"><file target-language="${locale}" source-language="en" original="lit-localize-inputs" datatype="plaintext"><body>\n${units}\n</body></file></xliff>\n`

describe('lit-localize', () => {
  it('computes the ids of lit-localize', () => {
    // From `lit-localize extract`.
    expect(messageId(['Hello World'], false)).toBe('s3d58dee72d4e0c27')
    expect(messageId(['Hello ', ''], false)).toBe('saed7d3734ce7f09d')
    expect(messageId(['Hello <b>World</b>'], true)).toBe('hf71d669027554f48')
    expect(messageId(['<a href="/x">Go ', '</a> now'], true)).toBe('h05d86068a68282fd')
    expect(messageId(['A ', ' and ', ' end'], false)).toBe('sbe295ebb71d8c8d4')
    expect(messageId(['It\'s ok'], false)).toBe('sb99591f3fd9d6610')
  })

  const files = {
    'package.json': json({
      dependencies: { '@lit/localize': '*', 'lit': '*' },
    }),
    'lit-localize.json': json({
      sourceLocale: 'en',
      targetLocales: ['fr', 'de'],
      interchange: { format: 'xliff', xliffDir: './xliff/' },
    }),
    'xliff/fr.xlf': xlf('fr', [
      unit('s3d58dee72d4e0c27', 'Hello World', 'Bonjour'),
      unit('saed7d3734ce7f09d', 'Hello <x id="0" equiv-text="${name}"/>'), // eslint-disable-line no-template-curly-in-string
      unit('buffalo-animal', 'Buffalo'),
      unit('sffffffffffffffff', 'Old text'),
    ].join('\n')),
    // `lit-localize extract` writes every message to every target file.
    'xliff/de.xlf': xlf('de', [
      unit('s3d58dee72d4e0c27', 'Hello World', 'Hallo'),
      unit('saed7d3734ce7f09d', 'Hello <x id="0" equiv-text="${name}"/>'), // eslint-disable-line no-template-curly-in-string
      unit('buffalo-animal', 'Buffalo'),
      unit('sffffffffffffffff', 'Old text'),
    ].join('\n')),
    'src/a.ts': [
      'import { msg, str } from \'@lit/localize\'',
      'export const a = msg(\'Hello World\')',
      'export const b = msg(str`Hello ${name}`, { desc: \'A greeting\' })', // eslint-disable-line no-template-curly-in-string
      'export const c = msg(\'Buffalo\', { id: \'buffalo-animal\' })',
      'export const d = msg(html`Hello <b>World</b>`)',
      'export const e = other.msg(\'Not this\')',
    ].join('\n'),
    'src/not-lit.ts': 'export const f = msg(\'Other library\')',
  }

  it('reads usages, the source from a target file, and targets', async () => {
    const { project } = await createTestProject(files, {
      presets: [
        litLocalize(),
      ],
    })
    expect(project.sourceLocale).toBe('en')
    expect([...project.locales].sort()).toEqual(['de', 'en', 'fr'])
    expect(project.usages().map(m => m.usage.key)).toEqual([
      's3d58dee72d4e0c27',
      'saed7d3734ce7f09d',
      'buffalo-animal',
      'hf71d669027554f48',
    ])
    expect(project.message(project.parseKey('s3d58dee72d4e0c27'), 'en')?.value).toBe('Hello World')
    expect(project.message(project.parseKey('s3d58dee72d4e0c27'), 'fr')?.value).toBe('Bonjour')
    expect(project.message(project.parseKey('saed7d3734ce7f09d'), 'en')?.value).toBe('Hello {$0}')
    expect(project.usages()[1]!.usage.description).toBe('A greeting')
    expect(project.analyze().unused).toEqual(['sffffffffffffffff'])
  })

  it('writes targets, and never the source text', async () => {
    const { project } = await createTestProject(files, {
      presets: [
        litLocalize(),
      ],
    })
    await project.apply(project.plan([
      {
        type: 'set',
        key: project.parseKey('saed7d3734ce7f09d'),
        locale: 'fr',
        value: 'Salut {$0}',
      },
    ]))
    expect(project.text('xliff/fr.xlf')).toContain('<target>Salut <x id="0" equiv-text="${name}"/></target>') // eslint-disable-line no-template-curly-in-string
    expect(() => project.plan([
      {
        type: 'set',
        key: project.parseKey('s3d58dee72d4e0c27'),
        locale: 'en',
        value: 'Changed',
      },
    ])).toThrow()
  })
})
