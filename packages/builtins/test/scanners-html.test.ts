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
