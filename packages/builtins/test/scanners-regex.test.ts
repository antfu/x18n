import type { Project, SourceFile } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { ngxTranslate } from '../src/presets/ngx-translate'
import { commentRanges, maskRanges, rememberComments } from '../src/scanners/shared/comments'
import { createTestProject, json } from './_utils'

async function ngxProject(files: Record<string, string>): Promise<Project> {
  const { project } = await createTestProject({
    'src/assets/i18n/en.json': json({}),
    ...files,
  }, {
    presets: [
      ngxTranslate(),
    ],
  })
  return project
}

/** `path:key@offset` of every usage, with the offset the key has in the unmasked file. */
function usages(project: Project): string[] {
  return project.usages().map(m => `${m.usage.path}:${m.usage.key}@${m.usage.range.start}`)
}

function at(text: string, key: string, nth = 0): number {
  let offset = -1
  for (let i = 0; i <= nth; i++)
    offset = text.indexOf(`${key}'`, offset + 1)
  return offset
}

describe('regex scanner and comments', () => {
  it('skips keys in JSDoc examples, line and block comments of TS files', async () => {
    const ts = [
      `import { Component } from '@angular/core'`,
      ``,
      `/**`,
      ` * Usage:`,
      ` *`,
      ` * \`\`\`html`,
      ` * <p>{{ 'doc.example' | translate }}</p>`,
      ` * \`\`\``,
      ` */`,
      `@Component({`,
      `  selector: 'app-demo',`,
      `  // template: \`{{ 'old.line' | translate }}\`,`,
      `  /* template: \`{{ 'old.block' | translate }}\`, */`,
      `  template: \`<h1>{{ 'real.title' | translate }}</h1>\`,`,
      `})`,
      `export class DemoComponent {}`,
    ].join('\n')
    const project = await ngxProject({ 'src/app/demo.component.ts': ts })
    expect(usages(project)).toEqual([
      `src/app/demo.component.ts:real.title@${at(ts, 'real.title')}`,
    ])
  })

  it('skips commented-out markup of HTML files, and keeps the offsets of what follows', async () => {
    const html = [
      `<!--`,
      `  <p>{{ 'old.block' | translate }}</p>`,
      `  <p translate="old.attribute"></p>`,
      `-->`,
      `<p>{{ 'real.text' | translate }}</p> <!-- {{ 'old.inline' | translate }} -->`,
      `<p translate="real.attribute"></p>`,
    ].join('\n')
    const project = await ngxProject({ 'src/app/app.component.html': html })
    expect(usages(project)).toEqual([
      `src/app/app.component.html:real.text@${at(html, 'real.text')}`,
      `src/app/app.component.html:real.attribute@${html.indexOf('real.attribute')}`,
    ])
  })

  it('skips HTML comments inside inline templates, and keeps `//` inside their strings', async () => {
    const ts = [
      `@Component({`,
      `  template: \``,
      `    <!-- <p>{{ 'old.inline' | translate }}</p> -->`,
      `    <a href="https://example.com/docs">{{ 'real.link' | translate }}</a>`,
      `    <a [title]="'real.url' | translate" href="//cdn.example.com/x">x</a>`,
      `  \`,`,
      `})`,
      `export class LinkComponent {}`,
    ].join('\n')
    const html = `<a href="https://example.com">{{ 'real.html' | translate }}</a>`
    const project = await ngxProject({
      'src/app/link.component.ts': ts,
      'src/app/page.component.html': html,
    })
    expect(usages(project)).toEqual([
      `src/app/link.component.ts:real.link@${at(ts, 'real.link')}`,
      `src/app/link.component.ts:real.url@${at(ts, 'real.url')}`,
      `src/app/page.component.html:real.html@${at(html, 'real.html')}`,
    ])
  })

  it('masks an unclosed `<!--` to the end of the file, or of the inline template that holds it', async () => {
    const html = `<p>{{ 'real.before' | translate }}</p>\n<!-- <p>{{ 'old.after' | translate }}</p>\n`
    const ts = [
      `@Component({ template: \`<!-- {{ 'old.unclosed' | translate }}\` })`,
      `export class A {}`,
      `@Component({ template: \`{{ 'real.next' | translate }}\` })`,
      `export class B {}`,
    ].join('\n')
    const project = await ngxProject({
      'src/app/a.component.html': html,
      'src/app/b.component.ts': ts,
    })
    expect(usages(project)).toEqual([
      `src/app/a.component.html:real.before@${at(html, 'real.before')}`,
      `src/app/b.component.ts:real.next@${at(ts, 'real.next')}`,
    ])
  })

  it('keeps `@x18n-keys` markers and `x18n-disable` comments working', async () => {
    const ts = [
      `// @x18n-keys`,
      `const keys = ['marked.one', 'marked.two']`,
      `@Component({ template: \`{{ 'real.title' | translate }}\` })`,
      `export class A {}`,
    ].join('\n')
    const html = [
      `<!-- x18n-disable-next-line -->`,
      `<p>{{ 'disabled.key' | translate }}</p>`,
      `<p>{{ 'real.text' | translate }}</p>`,
    ].join('\n')
    const project = await ngxProject({
      'src/app/a.component.ts': ts,
      'src/app/a.component.html': html,
    })
    expect(project.usages().map(m => `${m.usage.key}:${m.usage.kind}`)).toEqual([
      'real.text:call',
      'marked.one:marker',
      'marked.two:marker',
      'real.title:call',
    ])
  })
})

describe('commentRanges', () => {
  it('reuses the comments the js scanner remembered for the same file', async () => {
    const file: SourceFile = { path: 'a.ts', extension: 'ts', text: `const a = 1 // x` }
    expect(await commentRanges(file)).toEqual([
      { start: 12, end: 16 },
    ])
    // A different file object with the same text: the parse the `js` scanner made is what counts.
    const scanned: SourceFile = { ...file }
    rememberComments(scanned, {
      type: 'Program',
      start: 0,
      end: 16,
      body: [],
      sourceType: 'module',
      hashbang: null,
    }, [])
    expect(await commentRanges(scanned)).toEqual([])
  })

  it('finds no comments in other files, and masks to same-length whitespace', async () => {
    expect(await commentRanges({ path: 'a.vue', extension: 'vue', text: '<!-- x -->' })).toEqual([])
    const text = `a /* b\nc */ d`
    const masked = maskRanges(text, [
      { start: 2, end: 11 },
    ])
    expect(masked).toBe(`a     \n     d`)
    expect(masked).toHaveLength(text.length)
    expect(maskRanges(text, [])).toBe(text)
  })
})
