import type { Project } from '@x18n/core'
import { compile } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'
import { extractableHardStrings, extractItems, findCandidates, shouldExtract, slugify } from '../src/extractors'
import { i18next } from '../src/presets/i18next'
import { laravel } from '../src/presets/laravel'
import { laravelVueI18n } from '../src/presets/laravel-vue-i18n'
import { paraglide } from '../src/presets/paraglide'
import { reactI18next } from '../src/presets/react-i18next'
import { reactIntl } from '../src/presets/react-intl'
import { svelteI18n } from '../src/presets/svelte-i18n'
import { svelteI18next } from '../src/presets/svelte-i18next'
import { typesafeI18n } from '../src/presets/typesafe-i18n'
import { vueI18n } from '../src/presets/vue-i18n'
import { createTestProject, json } from './_utils'

async function extractAll(project: Project): Promise<void> {
  const items = extractItems(project, findCandidates(project))
  await project.apply(project.plan([
    { type: 'extract', items },
  ]))
}

describe('extraction rules', () => {
  it('generates bare camelCase slugs', () => {
    expect(slugify('Forgot password?')).toBe('forgotPassword')
    expect(slugify('Forgot password?', 'snake')).toBe('forgot_password')
    expect(slugify('Ça va très bien')).toBe('caVaTresBien')
  })

  it('folds rule scores', () => {
    expect(shouldExtract('Hello world', 'js-string')).toBe(true)
    expect(shouldExtract('click', 'js-string')).toBe(false)
    expect(shouldExtract('Save', 'jsx-text')).toBe(true)
    expect(shouldExtract('https://x.dev', 'jsx-text')).toBe(false)
    expect(shouldExtract('some-class-name', 'jsx-attribute')).toBe(false)
    expect(shouldExtract('你好', 'js-string')).toBe(true)
    expect(shouldExtract('SCREAMING_CASE', 'jsx-text')).toBe(false)
  })

  it('skips class lists, SVG paths and text-free markup', () => {
    expect(shouldExtract('!color-base underline underline-offset-6', 'js-string')).toBe(false)
    expect(shouldExtract('flex items-center gap-2 hover:bg-gray/10', 'js-string')).toBe(false)
    expect(shouldExtract('M5.5 0v11M0 5.5h11', 'js-string')).toBe(false)
    expect(shouldExtract('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {0} {1}">{2}</svg>', 'js-template')).toBe(false)
    expect(shouldExtract('<b>Save</b> your changes', 'js-string')).toBe(true)
    expect(shouldExtract('well-known issue', 'js-string')).toBe(true)
    expect(shouldExtract('Move to trash', 'js-string')).toBe(true)
  })

  it('skips attributify utilities on text props and CSS values', () => {
    expect(shouldExtract('xs secondary', 'vue-attribute', undefined, 'text')).toBe(false)
    expect(shouldExtract('lg', 'vue-attribute', undefined, 'sm:text')).toBe(false)
    expect(shouldExtract('Save changes', 'vue-attribute', undefined, 'text')).toBe(true)
    expect(shouldExtract('repeating-linear-gradient(to right,var(--c-primary) 0%,var(--c-primary-active) 100%)', 'js-string')).toBe(false)
    expect(shouldExtract('calc(100% - 2rem)', 'js-string')).toBe(false)
  })

  it('extracts only text attributes from markup', async () => {
    const tag = '<component as="RouterLink" flex="~ col gap-2" border="b base" w="sm:1/2 full" color="var(--c-primary)" enter-from-class="opacity-0" text="xs secondary" title="Open menu" aria-label="Close dialog" confirm-text="Yes please" empty-state="Nothing here">Hidden</component>'
    const { project } = await createTestProject({
      'locales/en.json': json({}),
      'src/App.vue': `<template>\n  ${tag}\n</template>\n`,
      'src/App.tsx': `export const App = () => ${tag.replace('enter-from-class', 'className')}\n`,
      'src/App.svelte': `${tag.replace('enter-from-class', 'class')}\n`,
      'src/App.astro': `${tag.replace('enter-from-class', 'class')}\n`,
    }, {
      presets: [
        vueI18n(),
        svelteI18n(),
      ],
      extract: {
        attributes: ['empty-state'],
      },
    })
    expect(findCandidates(project).map(c => `${c.path}:${c.attribute ?? c.kind}`)).toEqual([
      'src/App.astro:title',
      'src/App.astro:aria-label',
      'src/App.astro:confirm-text',
      'src/App.astro:empty-state',
      'src/App.astro:astro-text',
      'src/App.svelte:title',
      'src/App.svelte:aria-label',
      'src/App.svelte:confirm-text',
      'src/App.svelte:empty-state',
      'src/App.svelte:svelte-text',
      'src/App.tsx:title',
      'src/App.tsx:aria-label',
      'src/App.tsx:confirm-text',
      'src/App.tsx:empty-state',
      'src/App.tsx:jsx-text',
      'src/App.vue:title',
      'src/App.vue:aria-label',
      'src/App.vue:confirm-text',
      'src/App.vue:empty-state',
      'src/App.vue:vue-template-text',
    ])
  })
})

describe('config ignores', () => {
  it('skips exact strings and /regex/ from extract.ignore and extract.ignoreByFile', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({}),
      'src/a.ts': 'export const a = [\'Hello there\', \'Brand Name\', \'TODO: later\', \'Kept text\']',
      'src/b.ts': 'export const b = [\'Only here\', \'Brand Name\']',
    }, {
      extract: {
        ignore: ['Brand Name', '/^todo:/i'],
        ignoreByFile: {
          'src/b.ts': ['Only here'],
        },
      },
    })
    expect(findCandidates(project).map(c => c.text)).toEqual(['Hello there', 'Kept text'])
  })
})

describe('skipped files and control comments', () => {
  const line = 'export const a = \'Hello there\''

  it('skips tests, fixtures, stories, configs and declarations in any language', () => {
    const skipped = [
      'src/a.test.ts',
      'src/a.spec.tsx',
      'src/__tests__/a.ts',
      'src/Button.stories.vue',
      'e2e/login.ts',
      'cypress/support/a.js',
      'src/env.d.ts',
      'vite.config.ts',
      'src/config.ts',
      'handler_test.go',
      'testdata/a.go',
      'tests/test_views.py',
      'app/test_views.py',
      'app/tests.py',
      'conftest.py',
      'spec/models/user_spec.rb',
      'test/user_test.exs',
      'src/test/java/app/UserTest.java',
      'app/src/main/java/app/UserIT.java',
      'Tests/UserTests.swift',
      'tests/Feature/LoginTest.php',
      'lib/widget_test.dart',
    ]
    const kept = [
      'src/App.vue',
      'src/configure.ts',
      'src/Latest.vue',
      'app/views.py',
      'app/Contest.java',
      'src/protest.ts',
      'lib/spectrum.dart',
    ]
    const hard = [
      ...skipped,
      ...kept,
    ].map(path => ({
      path,
      text: 'Hello there',
      kind: 'js-string',
      range: { start: 0, end: 13 },
    }))
    expect([
      ...extractableHardStrings({}, hard, () => ''),
    ].map(h => h.path)).toEqual(kept)
  })

  it('honours x18n-ignore-file, x18n-ignore-start/end and x18n-ignore', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({}),
      'src/whole.ts': `// x18n-ignore-file\n${line}`,
      'src/parts.ts': [
        'export const a = \'Kept first\'',
        '// x18n-ignore-start',
        'export const b = \'Skipped region\'',
        'export const c = \'Skipped too\'',
        '// x18n-ignore-end',
        'export const d = \'Kept after end\'',
        'export const e = \'Skipped line\' // x18n-ignore',
        '// x18n-ignore',
        'export const f = \'Skipped next\'',
        'export const g = \'Kept last\'',
      ].join('\n'),
    })
    expect(findCandidates(project).map(c => c.text)).toEqual(['Kept first', 'Kept after end', 'Kept last'])
  })
})

describe('extraction per preset', () => {
  it('vue-i18n: template text, attributes and script strings', async () => {
    const { project, files } = await createTestProject({
      'src/locales/en.json': json({ existing: 'Already here' }),
      'src/App.vue': [
        '<script setup lang="ts">',
        'const label = \'Click to continue\'',
        '</script>',
        '',
        '<template>',
        '  <h1 title="Main title">Welcome back</h1>',
        '  <p>Already here</p>',
        '  <!-- x18n-ignore -->',
        '  <p>Ignored text</p>',
        '</template>',
      ].join('\n'),
    }, {
      presets: [
        vueI18n(),
      ],
    })
    const candidates = findCandidates(project)
    expect(candidates.map(c => `${c.kind}:${c.key}${c.reused ? '*' : ''}`)).toEqual([
      'js-string:clickToContinue',
      'vue-attribute:mainTitle',
      'vue-template-text:welcomeBack',
      'vue-template-text:existing*',
    ])
    await extractAll(project)
    expect(files.get('src/App.vue')).toBe([
      '<script setup lang="ts">',
      'import { useI18n } from \'vue-i18n\'',
      'const { t } = useI18n()',
      'const label = t(\'clickToContinue\')',
      '</script>',
      '',
      '<template>',
      '  <h1 :title="$t(\'mainTitle\')">{{ $t(\'welcomeBack\') }}</h1>',
      '  <p>{{ $t(\'existing\') }}</p>',
      '  <!-- x18n-ignore -->',
      '  <p>Ignored text</p>',
      '</template>',
    ].join('\n'))
    expect(JSON.parse(files.get('src/locales/en.json')!)).toEqual({
      existing: 'Already here',
      clickToContinue: 'Click to continue',
      mainTitle: 'Main title',
      welcomeBack: 'Welcome back',
    })
  })

  it('laravel-vue-i18n with laravel: sentence keys, $t in templates, trans in scripts, :name placeholders', async () => {
    const { project, files } = await createTestProject({
      'lang/en.json': json({}),
      'resources/js/App.vue': [
        '<script setup lang="ts">',
        'const msg = `Signed in as ${name}`', // eslint-disable-line no-template-curly-in-string
        '</script>',
        '',
        '<template>',
        '  <h1 title="Main title">Welcome back</h1>',
        '</template>',
      ].join('\n'),
    }, {
      presets: [
        laravelVueI18n(),
        laravel(),
      ],
    })
    await extractAll(project)
    expect(files.get('resources/js/App.vue')).toBe([
      '<script setup lang="ts">',
      'import { trans } from \'laravel-vue-i18n\'',
      'const msg = trans(\'Signed in as :name\', { name })',
      '</script>',
      '',
      '<template>',
      '  <h1 :title="$t(\'Main title\')">{{ $t(\'Welcome back\') }}</h1>',
      '</template>',
    ].join('\n'))
    expect(JSON.parse(files.get('lang/en.json')!)).toEqual({ 'Main title': 'Main title', 'Signed in as :name': 'Signed in as :name', 'Welcome back': 'Welcome back' })
  })

  it('i18next in Astro: template text and attributes, frontmatter strings with imports in the frontmatter', async () => {
    const { project, files } = await createTestProject({
      'locales/en.json': json({}),
      'src/pages/index.astro': [
        '---',
        'const label = \'Click to continue\'',
        '---',
        '<h1 title="Main title" class="text-xl">Welcome back, {name}!</h1>',
        '<script>',
        '  document.title = \'Welcome to the page\'',
        '</script>',
        '',
      ].join('\n'),
    }, {
      presets: [
        i18next(),
      ],
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    await extractAll(project)
    expect(files.get('src/pages/index.astro')).toBe([
      '---',
      'import i18next from \'i18next\'',
      'const label = i18next.t(\'clickToContinue\')',
      '---',
      '<h1 title={t(\'mainTitle\')} class="text-xl">{t(\'welcomeBack\')} {name}!</h1>',
      '<script>',
      '  document.title = \'Welcome to the page\'',
      '</script>',
      '',
    ].join('\n'))
    expect(JSON.parse(files.get('locales/en.json')!)).toEqual({ clickToContinue: 'Click to continue', mainTitle: 'Main title', welcomeBack: 'Welcome back,' })
  })

  it('puts imports in the first script when a leading --- has no closing line', async () => {
    const { project, files } = await createTestProject({
      'src/locales/en.json': json({}),
      'src/App.vue': '---\n<script setup lang="ts">\nconst label = \'Click to continue\'\n</script>\n',
    }, {
      presets: [
        vueI18n(),
      ],
    })
    await extractAll(project)
    expect(files.get('src/App.vue')).toBe([
      '---',
      '<script setup lang="ts">',
      'import { useI18n } from \'vue-i18n\'',
      'const { t } = useI18n()',
      'const label = t(\'clickToContinue\')',
      '</script>',
      '',
    ].join('\n'))
  })

  it('react-i18next: JSX text through Trans, attributes through i18next.t, template arguments', async () => {
    const { project, files } = await createTestProject({
      'locales/en/translation.json': json({}),
      'src/App.tsx': 'export const A = () => <p aria-label="x" title="Close dialog">Hello there</p>\nconst msg = `Signed in as ${user.name}`\n', // eslint-disable-line no-template-curly-in-string
    }, {
      presets: [
        reactI18next(),
      ],
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
    })
    await extractAll(project)
    expect(files.get('src/App.tsx')).toBe([
      'import i18next from \'i18next\'',
      'import { Trans } from \'react-i18next\'',
      'export const A = () => <p aria-label="x" title={i18next.t(\'closeDialog\')}><Trans i18nKey="helloThere" /></p>',
      'const msg = i18next.t(\'signedInAs\', { name: user.name })',
      '',
    ].join('\n'))
    expect(JSON.parse(files.get('locales/en/translation.json')!)).toEqual({ closeDialog: 'Close dialog', helloThere: 'Hello there', signedInAs: 'Signed in as {{name}}' })
  })

  it('svelte-i18next: markup through $i18n.t, keeping the store the component imports', async () => {
    const { project, files } = await createTestProject({
      'locales/en/translation.json': json({}),
      'src/App.svelte': '<script>\n  import i18n from \'./i18n\'\n</script>\n<p title="Close dialog">Hello there</p>\n',
    }, {
      presets: [
        svelteI18next(),
      ],
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
    })
    await extractAll(project)
    const output = files.get('src/App.svelte')!
    expect(output).toBe([
      '<script>',
      '  import i18n from \'./i18n\'',
      '</script>',
      '<p title={$i18n.t(\'closeDialog\')}>{$i18n.t(\'helloThere\')}</p>',
      '',
    ].join('\n'))
    expect(() => compile(output, { filename: 'App.svelte' })).not.toThrow()
    expect(JSON.parse(files.get('locales/en/translation.json')!)).toEqual({ closeDialog: 'Close dialog', helloThere: 'Hello there' })
  })

  it('escapes source-text keys for the quotes of each template', async () => {
    const { project: react } = await createTestProject({
      'locales/en/translation.json': json({}),
      'src/App.tsx': 'export function A() {\n  const label = "Don\'t stop now"\n  return <p>Say "hi" there</p>\n}\n',
    }, {
      presets: [
        reactI18next(),
      ],
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
      extract: { keygen: 'source' },
    })
    expect(findCandidates(react).map(c => c.replacement)).toEqual([
      'i18next.t(\'Don\\\'t stop now\')',
      '<Trans i18nKey="Say &quot;hi&quot; there" />',
    ])
    const { project: vue } = await createTestProject({
      'src/locales/en.json': json({}),
      'src/App.vue': '<template>\n  <p title="It\'s here now">Don\'t stop now</p>\n</template>\n',
    }, {
      presets: [
        vueI18n(),
      ],
      extract: { keygen: 'source' },
    })
    expect(findCandidates(vue).map(c => c.replacement)).toEqual([
      ':title="$t(\'It\\\'s here now\')"',
      '{{ $t(\'Don\\\'t stop now\') }}',
    ])
  })

  it('fills {text} with the message, escaped for the quotes of each template', async () => {
    const { project: vue } = await createTestProject({
      'src/locales/en.json': json({}),
      'src/App.vue': [
        '<template>',
        '  <p title="Tom &amp; Jerry\'s show">Say "hi" there</p>',
        '</template>',
        '<script setup>',
        'const a = "It\'s a \\\\ path"',
        'const b = `Line one\nline two`',
        'const c = `Hi ${user.name}, it\'s on`', // eslint-disable-line no-template-curly-in-string
        '</script>',
        '',
      ].join('\n'),
      'src/B.vue': '<template>\n  <p>Pay ${price} in `cash` today</p>\n</template>\n', // eslint-disable-line no-template-curly-in-string
    }, {
      presets: [
        vueI18n(),
      ],
      extract: {
        templates: [
          {
            template: '{{ $t(\'{key}\', `{text}`) }}',
            kinds: ['vue-template-text'],
            files: ['src/B.vue'],
          },
          {
            template: '{{ $t(\'{key}\', \'{text}\') }}',
            kinds: ['vue-template-text'],
          },
          {
            template: ':{attr}="$t(\'{key}\', \'{text}\')"',
            kinds: ['vue-attribute'],
          },
          {
            template: 't(\'{key}\', `{text}`{args})',
            kinds: ['js-template'],
          },
          { template: 't("{key}", "{text}")' },
        ],
      },
    })
    expect(findCandidates(vue).map(c => [c.value, c.replacement])).toEqual([
      ['It\'s a \\ path', 't("itSAPath", "It\'s a \\\\ path")'],
      ['Line one\nline two', 't(\'lineOneLineTwo\', `Line one\nline two`)'],
      ['Hi {name}, it\'s on', 't(\'hiItSOn\', `Hi {name}, it\'s on`, { name: user.name })'],
      ['Tom & Jerry\'s show', ':title="$t(\'tomJerrySShow\', \'Tom &amp; Jerry\\\'s show\')"'],
      ['Say "hi" there', '{{ $t(\'sayHiThere\', \'Say "hi" there\') }}'],
      ['Pay ${price} in `cash` today', '{{ $t(\'payPriceInCashToday\', `Pay \\${price} in \\`cash\\` today`) }}'], // eslint-disable-line no-template-curly-in-string
    ])
  })

  it('escapes {text} line breaks in JS strings and quotes in single-quoted attributes', async () => {
    const { project } = await createTestProject({
      'locales/en/translation.json': json({}),
      'src/a.ts': 'export const a = `Costs ${price}\nor never`\n', // eslint-disable-line no-template-curly-in-string
      'src/c.tsx': 'export const C = () => <p>Tom\'s "big" day</p>\n',
    }, {
      presets: [
        reactI18next(),
      ],
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
      extract: {
        templates: [
          {
            template: 'i18next.t(\'{key}\', \'{text}\'{args})',
            files: ['src/a.ts'],
          },
          {
            template: '<Trans i18nKey=\'{key}\' defaults=\'{text}\' />',
            files: ['src/c.tsx'],
          },
        ],
      },
    })
    expect(findCandidates(project).map(c => [c.value, c.replacement])).toEqual([
      ['Costs {{price}}\nor never', 'i18next.t(\'costsOrNever\', \'Costs {{price}}\\nor never\', { price })'],
      ['Tom\'s "big" day', '<Trans i18nKey=\'tomSBigDay\' defaults=\'Tom&#39;s "big" day\' />'],
    ])
  })

  it('react-intl: FormattedMessage and formatMessage', async () => {
    const { project, files } = await createTestProject({
      'lang/en.json': json({}),
      'src/App.tsx': 'const A = () => <button>Save changes</button>\n',
    }, {
      presets: [
        reactIntl(),
      ],
      resources: [
        { pattern: 'lang/{locale}.json' },
      ],
    })
    await extractAll(project)
    expect(files.get('src/App.tsx')).toBe('import { FormattedMessage } from \'react-intl\'\nconst A = () => <button><FormattedMessage id="saveChanges" /></button>\n')
  })

  it('typesafe-i18n: LL calls and the TS locale file', async () => {
    const { project, files } = await createTestProject({
      'src/i18n/en/index.ts': 'const en = {\n  title: \'Title\',\n} satisfies BaseTranslation\nexport default en\n',
      'src/App.tsx': 'const A = () => <button>Save changes</button>\nconst msg = `Signed in as ${user.name}`\n', // eslint-disable-line no-template-curly-in-string
      'src/Page.svelte': '<p>Welcome back home</p>\n',
    }, {
      presets: [
        typesafeI18n(),
      ],
    })
    await extractAll(project)
    expect(files.get('src/App.tsx')).toBe('const A = () => <button>{LL.saveChanges()}</button>\nconst msg = LL.signedInAs({ name: user.name })\n')
    expect(files.get('src/Page.svelte')).toBe('<p>{$LL.welcomeBackHome()}</p>\n')
    expect(files.get('src/i18n/en/index.ts')).toBe([
      'const en = {',
      '  title: \'Title\',',
      '  saveChanges: \'Save changes\',',
      '  signedInAs: \'Signed in as {name}\',',
      '  welcomeBackHome: \'Welcome back home\',',
      '} satisfies BaseTranslation',
      'export default en',
      '',
    ].join('\n'))
    expect(project.keys()).toEqual([
      'saveChanges',
      'signedInAs',
      'title',
      'welcomeBackHome',
    ])
  })

  it('paraglide: arguments are the first argument of the message function', async () => {
    const { project, files } = await createTestProject({
      'messages/en.json': json({}),
      'src/greet.ts': 'export const msg = `Signed in as ${user.name}`\n', // eslint-disable-line no-template-curly-in-string
    }, {
      presets: [
        paraglide(),
      ],
    })
    await extractAll(project)
    expect(files.get('src/greet.ts')).toBe('import { m } from \'$lib/paraglide/messages\'\nexport const msg = m.signedInAs({ name: user.name })\n')
  })

  it('refuses a plan whose source changed', async () => {
    const { project, files } = await createTestProject({
      'lang/en.json': json({}),
      'src/App.tsx': 'const a = \'Some text here\'\n',
    }, {
      resources: [
        { pattern: 'lang/{locale}.json' },
      ],
    })
    const candidates = findCandidates(project)
    files.set('src/App.tsx', 'const a = \'Other text here\'\n')
    await project.update([
      { type: 'change', path: 'src/App.tsx' },
    ])
    expect(() => extractItems(project, candidates)).toThrow(expect.objectContaining({ code: 'X18N4004' }))
  })
})

/* eslint-disable no-template-curly-in-string */
describe('extraction never overlaps', () => {
  function overlaps(project: Project): string[] {
    const items = [
      ...findCandidates(project),
    ].sort((a, b) => a.path.localeCompare(b.path) || a.range.start - b.range.start)
    return items.flatMap((item, i) => {
      const next = items[i + 1]
      return next && next.path === item.path && next.range.start < item.range.end
        ? [`${item.original} / ${next.original}`]
        : []
    })
  }

  it('in templates with strings inside, attributes and nested calls', async () => {
    const { project } = await createTestProject({
      'package.json': json({
        dependencies: { 'i18next': '*', 'react-i18next': '*', 'vue-i18n': '*' },
      }),
      'locales/en.json': json({}),
      'src/a.ts': [
        'export const a = `Hello there ${on ? \'yes please now\' : \'no thanks then\'} and more`',
        'export const b = `Outer text here ${`inner text here ${c}`} end`',
        'export const c = show(\'First words here\', { title: \'Second words here\' })',
      ].join('\n'),
      'src/b.tsx': 'export const d = <a title="Some long title" data-x={`Hello big ${y} world`}>Some long title {z ? \'Is on now\' : \'Is off now\'}</a>',
      'src/c.vue': '<template><a title="Some vue title" :label="\'Bound label text\'">Some vue text {{ on ? \'Yes it is\' : \'No it isnt\' }}</a></template>\n<script setup>\nconst e = `Hi from ${f ? \'script side\' : \'other side\'}`\n</script>\n',
    })
    expect(overlaps(project)).toEqual([])
    const items = extractItems(project, findCandidates(project))
    await project.apply(project.plan([
      { type: 'extract', items },
    ]))
    expect(project.text('src/a.ts')).toContain('{ arg0: on ? \'yes please now\' : \'no thanks then\' }')
  })
})
