import type { Project } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { extractItems, findCandidates } from '../src/extractors'
import { angularLocalize } from '../src/presets/angular-localize'
import { i18next } from '../src/presets/i18next'
import { ngxTranslate } from '../src/presets/ngx-translate'
import { transloco } from '../src/presets/transloco'
import { createTestProject, json } from './_utils'

function hardStrings(project: Project): string[] {
  return [
    ...project.hardStrings(),
  ].map(h => `${h.kind}:${h.attribute
    ? `${h.attribute}=`
    : ''}${h.text}`)
}

async function ngxProject(template: string, config: Parameters<typeof createTestProject>[1] = {}): Promise<Project> {
  const { project } = await createTestProject({
    'src/assets/i18n/en.json': json({ existing: 'Already here' }),
    'src/app/app.component.html': template,
  }, {
    presets: [
      ngxTranslate(),
    ],
    ...config,
  })
  return project
}

describe('html scanner', () => {
  it('finds text and text attributes', async () => {
    const project = await ngxProject([
      '<h1 class="title text-lg" title="Main title">Welcome back</h1>',
      '<input type="text" placeholder="Search here" aria-label="Search">',
      '<p>Tom &amp; Jerry</p>',
      '<p>   </p>',
      '<p>42</p>',
    ].join('\n'))
    expect(hardStrings(project)).toEqual([
      'html-attribute:title=Main title',
      'html-text:Welcome back',
      'html-attribute:placeholder=Search here',
      'html-attribute:aria-label=Search',
      'html-text:Tom & Jerry',
    ])
    const text = project.text('src/app/app.component.html')!
    const ranges = [
      ...project.hardStrings(),
    ].map(h => text.slice(h.range.start, h.range.end))
    expect(ranges.slice(0, 2)).toEqual(['title="Main title"', 'Welcome back'])
    expect(ranges[4]).toBe('Tom &amp; Jerry')
  })

  it('skips interpolations, bindings, events, references and structural directives', async () => {
    const project = await ngxProject([
      '<p>Hello {{ user.name }}, welcome</p>',
      '<p>{{ \'existing\' | translate }}</p>',
      '<img [alt]="\'Bound alt\'" (click)="open(\'Event text\')" #ref bind-title="x" *ngIf="shown">',
      '<button title="Hi {{ name }}" [attr.aria-label]="label">Save</button>',
      '<ng-template let-item="Item text">Template text</ng-template>',
    ].join('\n'))
    expect(hardStrings(project)).toEqual([
      'html-text:Hello',
      'html-text:, welcome',
      'html-text:Save',
      'html-text:Template text',
    ])
  })

  it('skips Angular control-flow parameters and keeps their content', async () => {
    const project = await ngxProject([
      '@if (user.isLoggedIn) {',
      '  <p>Signed in</p>',
      '} @else if (user.pending) {',
      '  Waiting for approval',
      '} @else {',
      '  <p>Signed out</p>',
      '}',
      '@for (item of items; track item.id; let idx = $index) {',
      '  <li>{{ item.name }}</li>',
      '} @empty {',
      '  <li>No items</li>',
      '}',
      '@switch (mode) {',
      '  @case (\'edit\') { <p>Editing</p> }',
      '  @default { <p>Viewing</p> }',
      '}',
      '@defer (on viewport; prefetch on idle) {',
      '  <big-chart />',
      '} @placeholder (minimum 500ms) {',
      '  <p>Chart placeholder</p>',
      '} @loading (after 100ms) {',
      '  Loading chart',
      '} @error {',
      '  Chart failed',
      '}',
      '@let greeting = \'Hello there\' + name;',
      '<p>Reach us at team@example.com</p>',
      '<p>{count, plural, =0 {No messages} other {Many messages}}</p>',
    ].join('\n'))
    expect(hardStrings(project)).toEqual([
      'html-text:Signed in',
      'html-text:Waiting for approval',
      'html-text:Signed out',
      'html-text:No items',
      'html-text:Editing',
      'html-text:Viewing',
      'html-text:Chart placeholder',
      'html-text:Loading chart',
      'html-text:Chart failed',
      'html-text:Reach us at team@example.com',
    ])
  })

  it('skips content already marked for translation, scripts and styles', async () => {
    const project = await ngxProject([
      '<p translate>existing</p>',
      '<p [translate]="\'existing\'">Fallback</p>',
      '<p transloco="existing">Fallback</p>',
      '<p i18n="@@intro">Angular <b>localized</b> text</p>',
      '<img i18n-alt alt="Localized alt" title="Plain title">',
      '<span translate="no">Brand Name</span>',
      '<script>const label = \'Script text\'</script>',
      '<style>.a::after { content: "Style text" }</style>',
      '<p>Kept text</p>',
    ].join('\n'))
    expect(hardStrings(project)).toEqual([
      'html-attribute:title=Plain title',
      'html-text:Kept text',
    ])
  })

  it('honours extract.attributes', async () => {
    const project = await ngxProject('<app-empty empty-state="Nothing here" mode="compact"></app-empty>', {
      extract: {
        attributes: ['empty-state'],
      },
    })
    expect(hardStrings(project)).toEqual(['html-attribute:empty-state=Nothing here'])
  })

  it('runs only for presets that list it, and once when several do', async () => {
    const files = {
      'locales/en.json': json({}),
      'src/assets/i18n/en.json': json({}),
      'index.html': '<title>My app</title>\n<p>Hello there</p>',
    }
    const plain = await createTestProject(files, {
      presets: [
        i18next(),
      ],
    })
    expect(hardStrings(plain.project)).toEqual([])
    const both = await createTestProject(files, {
      presets: [
        ngxTranslate(),
        transloco(),
      ],
    })
    expect(hardStrings(both.project)).toEqual(['html-text:My app', 'html-text:Hello there'])
  })

  it('keeps template usages next to hard strings', async () => {
    const project = await ngxProject([
      '<h1>{{ \'existing\' | translate }}</h1>',
      '<p translate>existing</p>',
      '<p>Hard text</p>',
    ].join('\n'))
    expect(project.usages().map(m => m.usage.key)).toEqual(['existing', 'existing'])
    expect(hardStrings(project)).toEqual(['html-text:Hard text'])
  })

  it('leaves angular-localize templates to their own scanner', async () => {
    const { project } = await createTestProject({
      'angular.json': json({
        projects: {
          app: {
            i18n: { sourceLocale: 'en' },
          },
        },
      }),
      'src/app/app.component.html': '<p i18n="@@greeting">Hello</p>',
    }, {
      presets: [
        angularLocalize(),
      ],
    })
    expect(hardStrings(project)).toEqual([])
    expect(project.usages().map(m => m.usage.raw)).toEqual(['greeting'])
  })
})

describe('html extraction', () => {
  async function extractAll(project: Project): Promise<void> {
    await project.apply(project.plan([
      {
        type: 'extract',
        items: extractItems(project, findCandidates(project)),
      },
    ]))
  }

  const template = [
    '@if (ready) {',
    '  <h1 title="Main title">Welcome back</h1>',
    '}',
    '<p>Already here</p>',
    '<!-- x18n-ignore -->',
    '<p>Ignored text</p>',
    '<!-- x18n-ignore-start -->',
    '<p>Ignored region</p>',
    '<!-- x18n-ignore-end -->',
    '<p>{{ \'existing\' | translate }}</p>',
  ].join('\n')

  it('ngx-translate: text and attributes become translate pipes', async () => {
    const { project, files } = await createTestProject({
      'src/assets/i18n/en.json': json({ existing: 'Already here' }),
      'src/app/app.component.html': template,
    }, {
      presets: [
        ngxTranslate(),
      ],
    })
    expect(findCandidates(project).map(c => `${c.kind}:${c.key}${c.reused ? '*' : ''}`)).toEqual([
      'html-attribute:mainTitle',
      'html-text:welcomeBack',
      'html-text:existing*',
    ])
    await extractAll(project)
    expect(files.get('src/app/app.component.html')).toBe(template
      .replace('title="Main title">Welcome back', '[title]="\'mainTitle\' | translate">{{ \'welcomeBack\' | translate }}')
      .replace('<p>Already here</p>', '<p>{{ \'existing\' | translate }}</p>'))
    expect(JSON.parse(files.get('src/assets/i18n/en.json')!)).toEqual({
      existing: 'Already here',
      mainTitle: 'Main title',
      welcomeBack: 'Welcome back',
    })
  })

  it('transloco: text and attributes become transloco pipes', async () => {
    const { project, files } = await createTestProject({
      'src/assets/i18n/en.json': json({ existing: 'Already here' }),
      'src/app/app.component.html': template.replace('translate', 'transloco'),
    }, {
      presets: [
        transloco(),
      ],
    })
    await extractAll(project)
    expect(files.get('src/app/app.component.html')).toContain('<h1 [title]="\'mainTitle\' | transloco">{{ \'welcomeBack\' | transloco }}</h1>')
    expect(files.get('src/app/app.component.html')).toContain('<p>Ignored text</p>')
    expect(files.get('src/app/app.component.html')).toContain('<p>Ignored region</p>')
    expect(JSON.parse(files.get('src/assets/i18n/en.json')!)).toEqual({
      existing: 'Already here',
      mainTitle: 'Main title',
      welcomeBack: 'Welcome back',
    })
  })
})

describe('angular-localize extraction', () => {
  const angularJson = json({
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
  })

  async function localizeProject(template: string, code?: string): Promise<Project> {
    const { project } = await createTestProject({
      'angular.json': angularJson,
      'src/locale/messages.json': json({
        locale: 'en',
        translations: { existing: 'Already here' },
      }),
      'src/locale/messages.tr.json': json({
        locale: 'tr',
        translations: { existing: 'Zaten burada' },
      }),
      'src/app/app.html': template,
      ...code
        ? { 'src/app/app.ts': code }
        : {},
    }, {
      presets: [
        angularLocalize(),
      ],
    })
    return project
  }

  async function extracted(project: Project, path = 'src/app/app.html'): Promise<string> {
    await project.apply(project.plan([
      {
        type: 'extract',
        items: extractItems(project, findCandidates(project)),
      },
    ]))
    return project.text(path)!
  }

  it('marks an element as one message and keeps its content', async () => {
    const project = await localizeProject('<p class="a">Hello {{ user.name }}, read <a href="/x">the docs</a>.</p>')
    expect(hardStrings(project)).toEqual([
      'html-element:p=Hello {$INTERPOLATION}, read {$START_LINK}the docs{$CLOSE_LINK}.',
    ])
    const [item] = findCandidates(project)
    expect(item!.key).toBe('helloReadTheDocs')
    expect(await extracted(project)).toBe('<p i18n="@@helloReadTheDocs" class="a">Hello {{ user.name }}, read <a href="/x">the docs</a>.</p>')
    expect(project.message(project.parseKey('helloReadTheDocs'), project.sourceLocale)?.value).toBe(item!.value)
    expect(project.usages().map(m => m.usage.raw)).toContain('helloReadTheDocs')
  })

  it('marks single words, which are text in a template', async () => {
    const project = await localizeProject('<button (click)="save()">Save</button>')
    expect(await extracted(project)).toBe('<button i18n="@@save" (click)="save()">Save</button>')
  })

  it('wraps text with no element in an ng-container', async () => {
    const project = await localizeProject('@if (a) {\n  Tom &amp; Jerry &lt;3\n}\nTop level')
    expect(await extracted(project)).toBe([
      '@if (a) {',
      '  <ng-container i18n="@@tomJerry3">Tom &amp; Jerry &lt;3</ng-container>',
      '}',
      '<ng-container i18n="@@topLevel">Top level</ng-container>',
    ].join('\n'))
  })

  it('marks text attributes next to the attribute', async () => {
    const project = await localizeProject('<img src="a.png" alt="A &quot;nice&quot; cat" title="Hi {{ name }}">')
    expect(await extracted(project)).toBe('<img src="a.png" i18n-alt="@@aNiceCat" alt="A &quot;nice&quot; cat" title="Hi {{ name }}">')
  })

  it('goes down to the elements with text', async () => {
    const project = await localizeProject('<ul><li>First item</li><li>{{ second }}</li></ul>')
    expect(await extracted(project)).toBe('<ul><li i18n="@@firstItem">First item</li><li>{{ second }}</li></ul>')
  })

  it('never nests i18n elements', async () => {
    const project = await localizeProject('<div>Loose text <p i18n="@@existing">Already here</p></div>')
    expect(await extracted(project)).toBe('<div><ng-container i18n="@@looseText">Loose text</ng-container> <p i18n="@@existing">Already here</p></div>')
  })

  it('skips marked content but keeps the attributes inside it', async () => {
    const project = await localizeProject([
      '<p i18n="@@existing">Already here <img alt="Inner alt"></p>',
      '<span translate="no">Brand Name</span>',
      '<img i18n-alt="@@existing" alt="Already here">',
      '<p>{{ only.code }}</p>',
    ].join('\n'))
    expect(hardStrings(project)).toEqual(['html-attribute:alt=Inner alt'])
  })

  it('names an ICU key from its other case, or its first', async () => {
    const project = await localizeProject('<p>{n, plural, =0 {None at all} =1 {Just {{ who }} here}}</p>\n<p>{n, plural, =0 {Nothing} other {About {{ n }} items left}}</p>')
    expect(findCandidates(project).map(i => i.key)).toEqual(['noneAtAll', 'aboutItemsLeft'])
  })

  it('marks ICUs', async () => {
    const project = await localizeProject('<p>{count, plural, =0 {No messages} other {Many messages}}</p>\n@if (a) {\n  {n, select, a {Option one} other {Option two}}\n}')
    const items = findCandidates(project)
    expect(items.map(i => i.value)).toEqual([
      '{VAR_PLURAL, plural, =0 {No messages} other {Many messages}}',
      '{VAR_SELECT, select, a {Option one} other {Option two}}',
    ])
    expect(items.map(i => i.key)).toEqual(['manyMessages', 'optionTwo'])
    expect(await extracted(project)).toBe(`<p i18n="@@${items[0]!.key}">{count, plural, =0 {No messages} other {Many messages}}</p>\n@if (a) {\n  <ng-container i18n="@@${items[1]!.key}">{n, select, a {Option one} other {Option two}}</ng-container>\n}`)
  })

  it('uses $localize in code, escaped for the template literal', async () => {
    const project = await localizeProject('<p i18n="@@existing">Already here</p>', 'export const label = \'Say hello `now` to ${you}\'\n') // eslint-disable-line no-template-curly-in-string
    expect(await extracted(project, 'src/app/app.ts')).toBe('export const label = $localize`:@@sayHelloNowToYou:Say hello \\`now\\` to \\${you}`\n') // eslint-disable-line no-template-curly-in-string
  })

  it('names the arguments of a template in code', async () => {
    const project = await localizeProject('<p i18n="@@existing">Already here</p>', 'export const a = `Hello there ${user.firstName}, you have ${count} new`\n') // eslint-disable-line no-template-curly-in-string
    const [item] = findCandidates(project)
    expect(item!.value).toBe('Hello there {$FIRST_NAME}, you have {$COUNT} new')
    expect(await extracted(project, 'src/app/app.ts')).toBe('export const a = $localize`:@@helloThereYouHaveNew:Hello there ${user.firstName}:FIRST_NAME:, you have ${count}:COUNT: new`\n') // eslint-disable-line no-template-curly-in-string
  })

  it('leaves $localize in code alone', async () => {
    const project = await localizeProject('<p i18n="@@existing">Already here</p>', 'export const a = $localize`:@@existing:Already here`\n')
    expect(hardStrings(project)).toEqual([])
  })

  it('keeps text and interpolations with no element as one message', async () => {
    const project = await localizeProject('@if (a) {\n  Hello {{ name }}, welcome &amp; enjoy\n}\n{{ alone }}')
    const [item] = findCandidates(project)
    expect(item!.value).toBe('Hello {$INTERPOLATION}, welcome & enjoy')
    expect(await extracted(project)).toBe('@if (a) {\n  <ng-container i18n="@@helloWelcomeEnjoy">Hello {{ name }}, welcome &amp; enjoy</ng-container>\n}\n{{ alone }}')
  })

  it('marks inline templates of every kind of string', async () => {
    const project = await localizeProject('<p i18n="@@existing">Already here</p>', [
      '@Component({ template: `<p>Hello backtick world</p>` })',
      'export class A {}',
      '@Component({ template: \'<p title="It is here">Hello single quote</p>\' })',
      'export class B {}',
      '@Component({ template: "<p title=\'In double\'>Hello double quote</p>" })',
      'export class C {}',
      '@Component({ template: `<p>Escaped \\` tick here</p>\\n<b>Next one here</b>` })',
      'export class D {}',
      '@Component({ template: \'<p>It\\\'s here now</p>\' })',
      'export class E {}',
      '@Component({ template: \'Just plain text\' })',
      'export class F {}',
      'export const data = { template: \'Welcome to our site\' }',
    ].join('\n'))
    const items = findCandidates(project)
    expect(items.find(i => i.key === 'escapedTickHere')!.value).toBe('Escaped ` tick here')
    expect(items.find(i => i.key === 'itSHereNow')!.value).toBe('It\'s here now')
    expect(await extracted(project, 'src/app/app.ts')).toBe([
      '@Component({ template: `<p i18n="@@helloBacktickWorld">Hello backtick world</p>` })',
      'export class A {}',
      '@Component({ template: \'<p i18n="@@helloSingleQuote" i18n-title="@@itIsHere" title="It is here">Hello single quote</p>\' })',
      'export class B {}',
      '@Component({ template: "<p i18n=\'@@helloDoubleQuote\' i18n-title=\'@@inDouble\' title=\'In double\'>Hello double quote</p>" })',
      'export class C {}',
      '@Component({ template: `<p i18n="@@escapedTickHere">Escaped \\` tick here</p>\\n<b i18n="@@nextOneHere">Next one here</b>` })',
      'export class D {}',
      '@Component({ template: \'<p i18n="@@itSHereNow">It\\\'s here now</p>\' })',
      'export class E {}',
      '@Component({ template: \'<ng-container i18n="@@justPlainText">Just plain text</ng-container>\' })',
      'export class F {}',
      'export const data = { template: $localize`:@@welcomeToOurSite:Welcome to our site` }',
    ].join('\n'))
  })
})
