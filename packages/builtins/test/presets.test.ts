import type { Project } from '@x18n/core'
import { describe, expect, it } from 'vitest'
import { findCandidates } from '../src/extractors'
import { createTestProject, json } from './_utils'

function pkg(...deps: string[]): string {
  return json({
    dependencies: Object.fromEntries(deps.map(dep => [dep, '*'])),
  })
}

async function write(project: Project, ops: Parameters<Project['plan']>[0]): Promise<void> {
  const plan = project.plan(ops)
  await project.apply(plan, {
    answers: Object.fromEntries(plan.decisions.map(d => [d.id, d.default])),
  })
}

describe('tier 1 presets', () => {
  it('next-intl: useTranslations namespaces and t.rich', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('next-intl'),
      'messages/en.json': json({
        Home: { title: 'Hi {name}', rich: '<b>x</b>' },
        About: { text: 'a' },
      }),
      'app/page.tsx': [
        `import { useTranslations } from 'next-intl'`,
        `export default function Page() { const t = useTranslations('Home'); return <h1>{t('title', { name: 'x' })}{t.rich('rich', {})}</h1> }`,
        `export async function generateMetadata() { const t = await getTranslations({ namespace: 'About' }); return t('text') }`,
      ].join('\n'),
    })
    expect(project.explain().presets.find(p => p.name === 'next-intl')?.reason).toBe('detected')
    expect(project.usages().map(m => m.usage.key)).toEqual(['Home.title', 'Home.rich', 'About.text'])
    expect(project.analyze().unused).toEqual([])
  })

  it('next-intl: many scopes in one file and one function', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('next-intl'),
      'messages/en.json': json({
        common: { save: 'Save' },
        components: {
          specific: { label: 'L' },
        },
        Metadata: { title: 'T' },
        Page: { heading: 'H' },
      }),
      'app/page.tsx': [
        `import { useTranslations } from 'next-intl'`,
        `import { getTranslations } from 'next-intl/server'`,
        `export async function generateMetadata({ params: { locale } }) {`,
        `  const t = await getTranslations({ locale, namespace: 'Metadata' })`,
        `  const tPage = await getTranslations('Page')`,
        `  return { title: t('title'), description: tPage('heading') }`,
        `}`,
        `export function Button() {`,
        `  const t = useTranslations('common')`,
        `  const tSpecific = useTranslations('components.specific')`,
        `  return <button title={tSpecific('label')}>{t('save')}</button>`,
        `}`,
      ].join('\n'),
    })
    expect(project.usages().map(m => m.usage.key)).toEqual([
      'Metadata.title',
      'Page.heading',
      'components.specific.label',
      'common.save',
    ])
    expect(project.analyze().unused).toEqual([])
  })

  it('react-intl: formatMessage, FormattedMessage and defineMessages', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('react-intl'),
      'lang/en.json': json({ 'app.title': 'T', 'app.hello': 'Hello {name}', 'app.count': '{n, plural, one {# item} other {# items}}' }),
      'lang/de.json': json({ 'app.title': 'T', 'app.hello': 'Hallo {who}', 'app.count': '{n, plural, one {# Ding}}' }),
      'src/App.tsx': [
        `const m = defineMessages({ title: { id: 'app.title' } })`,
        `intl.formatMessage({ id: 'app.hello' }, { name })`,
        `const el = <FormattedMessage id="app.count" />`,
      ].join('\n'),
    })
    expect(project.usages().map(m => m.usage.key)).toEqual(['app.title', 'app.hello', 'app.count'])
    const codes = project.analyze().diagnostics.map(d => `${d.code}:${d.key}`)
    expect(codes).toContain('placeholder-mismatch:app.hello')
    expect(codes).toContain('invalid-syntax:app.count')
  })

  it('svelte-i18n: $_ in markup and script', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('svelte-i18n', 'svelte'),
      'src/locales/en.json': json({
        page: { title: 'T', body: 'B' },
      }),
      'src/App.svelte': `<script>\n  import { _ } from 'svelte-i18n'\n  const x = $_('page.body')\n</script>\n<h1 title={$_('page.title')}>Hello</h1>`,
    })
    expect(project.usages().map(m => m.usage.key)).toEqual(['page.body', 'page.title'])
  })

  it('solid-primitives-i18n: t calls with double-brace placeholders', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@solid-primitives/i18n', 'solid-js'),
      'src/locales/en.json': json({
        home: { title: 'Hi {{name}}' },
      }),
      'src/App.tsx': `export default () => <h1>{t('home.title', { name: 'x' })}</h1>`,
    })
    expect(project.explain().presets.find(p => p.name === 'solid-primitives-i18n')?.reason).toBe('detected')
    expect(project.usages().map(m => m.usage.key)).toEqual(['home.title'])
  })

  it('paraglide: m.key() and m[\'key\']() usages', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@inlang/paraglide-js'),
      'messages/en.json': json({ 'hello_world': 'Hello {name}', 'a.b': 'AB' }),
      'src/App.svelte': `<h1>{m.hello_world({ name })}</h1>\n<p>{m['a.b']()}</p>`,
    })
    expect(project.usages().map(m => m.usage.key)).toEqual(['hello_world', 'a.b'])
  })

  it('fluent-react: <Localized>, useLocalization and withLocalization', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@fluent/react', 'react'),
      'public/locales/en/main.ftl': 'hello = Hello { $name }\ntitle = Title\n',
      'public/locales/en/extra.ftl': 'bye = Bye\n',
      'public/locales/de/main.ftl': 'hello = Hallo { $who }\n',
      'src/App.tsx': [
        `const a = <Localized id="hello" vars={{ name }}><p>Hello</p></Localized>`,
        `function B() { const { l10n } = useLocalization(); return l10n.getString('title') }`,
        `function C(props) { return props.getString('bye') }`,
        `export default withLocalization(C)`,
        `const getString = (id) => id`,
        `getString('not-a-key')`,
      ].join('\n'),
    })
    expect(project.explain().presets.find(p => p.name === 'fluent-react')?.reason).toBe('detected')
    expect(project.keys()).toEqual(['bye', 'hello', 'title'])
    expect(project.usages().map(m => m.usage.key)).toEqual(['hello', 'title', 'bye'])
    expect(project.analyze().diagnostics.map(d => `${d.code}:${d.key}`)).toContain('placeholder-mismatch:hello')
  })

  it('fluent-react: attributes read through attrs are used', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@fluent/react'),
      'src/locales/en.ftl': 'login = Sign in\n    .title = Sign in to your account\n',
      'src/App.tsx': `export const App = () => <Localized id="login" attrs={{ title: true }}><button title="Sign in">Sign in</button></Localized>\n`,
    })
    expect(project.keys()).toEqual(['login', 'login.title'])
    expect(project.analyze().unused).toEqual([])
  })

  it('fluent-react: extracts JSX text into <Localized>', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@fluent/react'),
      'src/locales/en.ftl': 'title = Title\n',
      'src/App.tsx': `export function App() {\n  const { l10n } = useLocalization()\n  const label = 'Sign in'\n  return <p>Welcome home</p>\n}\n`,
    })
    expect(findCandidates(project).map(c => c.replacement)).toEqual(['l10n.getString(\'signIn\')', '<Localized id="welcomeHome" />'])
  })

  it('typesafe-i18n: TS locale files, namespaces, LL.a.b() usages and typed placeholders', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('typesafe-i18n'),
      'src/i18n/en/index.ts': [
        `import type { BaseTranslation } from '../i18n-types'`,
        `const en = {`,
        `  HI: 'Hi {name:string}!',`,
        `  apples: '{count:number} {{apple|apples}}',`,
        `  photo: '{gender|{male: his, female: her, *: their}} photo',`,
        `  nav: { home: 'Home', about: 'About' },`,
        `} satisfies BaseTranslation`,
        `export default en`,
      ].join('\n'),
      'src/i18n/en/dashboard/index.ts': `const en_dashboard = { title: 'Dashboard' }\nexport default en_dashboard\n`,
      'src/i18n/de/index.ts': [
        `import type { Translation } from '../i18n-types'`,
        `const de: Translation = { HI: 'Hallo {who}!', apples: '{count} {{Apfel|Äpfel}}', photo: '{sex|{male: sein, *: ihr}} Foto', nav: { home: 'Start', about: 'Über' } }`,
        `export default de`,
      ].join('\n'),
      'src/i18n/i18n-util.ts': `export const baseLocale = 'en'`,
      'src/App.tsx': `export const App = () => <h1>{LL.HI({ name })}{LL.nav.home()}{LL.apples(3)}{LL.photo({ gender })}</h1>`,
      'src/routes/+page.svelte': `<p>{$LL.dashboard.title()}</p>`,
    })
    expect(project.explain().presets.find(p => p.name === 'typesafe-i18n')?.reason).toBe('detected')
    expect(project.locales).toEqual(['en', 'de'])
    expect(project.keys()).toEqual([
      'HI',
      'apples',
      'dashboard.title',
      'nav.about',
      'nav.home',
      'photo',
    ])
    expect(project.usages().map(m => m.usage.key)).toEqual([
      'HI',
      'nav.home',
      'apples',
      'photo',
      'dashboard.title',
    ])
    const { diagnostics, unused } = project.analyze()
    expect(unused).toEqual(['nav.about'])
    expect(diagnostics.filter(d => d.code === 'placeholder-mismatch').map(d => d.message)).toEqual([
      '"HI" in de has different placeholders than en: missing name; unexpected who.',
      '"photo" in de has different placeholders than en: missing gender; unexpected sex.',
    ])
  })

  it('cargo-i18n: Cargo.toml, i18n.toml and fl! usages', async () => {
    const { project } = await createTestProject({
      'Cargo.toml': '[package]\nname = "app"\n\n[dependencies]\ni18n-embed = { version = "0.16", features = [\n  "fluent-system",\n] }\nrust-embed = "8"\n\n[dependencies.i18n-embed-fl]\nversion = "0.10"\n',
      'i18n.toml': 'fallback_language = "en-GB"\n\n[fluent]\nassets_dir = "./locales"\n',
      'locales/en-GB/app.ftl': 'hello-arg = Hello { $name }!\nlogin =\n    .title = Log in\nunused = Unused\n',
      'locales/de/app.ftl': 'hello-arg = Hallo { $user }!\n',
      'src/main.rs': 'fl!(LANGUAGE_LOADER, "hello-arg", name = "Bob");\nfl!(crate::loader(), "login", "title");\nfl!("missing-id");\n',
    })
    expect(project.explain().presets.find(p => p.name === 'cargo-i18n')?.reason).toBe('detected')
    expect(project.sourceLocale).toBe('en-GB')
    expect(project.locales).toEqual(['en-GB', 'de'])
    expect(project.keys()).toEqual(['hello-arg', 'login.title', 'unused'])
    expect(project.usages().map(m => m.usage.key)).toEqual(['hello-arg', 'login', 'missing-id'])
    const report = project.analyze()
    expect(report.unused).toEqual(['unused'])
    expect(report.diagnostics.map(d => `${d.code}:${d.key}`)).toEqual(expect.arrayContaining(['placeholder-mismatch:hello-arg', 'missing-key:missing-id']))
    expect(report.diagnostics.map(d => `${d.code}:${d.key}`)).not.toContain('missing-key:login')
  })

  it('cargo-i18n: workspace dependencies and the default i18n folder', async () => {
    const { project } = await createTestProject({
      'Cargo.toml': '[workspace]\nmembers = ["app"]\n\n[workspace.dependencies]\n"i18n-embed-fl" = "0.10"\n',
      'i18n/en/app.ftl': 'title = App\n',
    })
    expect(project.explain().presets.find(p => p.name === 'cargo-i18n')?.reason).toBe('detected')
    expect(project.keys()).toEqual(['title'])
  })

  it.each([
    ['a dotted key', '[dependencies]\ni18n-embed-fl.workspace = true\n'],
    ['a quoted dotted key', '[dependencies]\n"i18n-embed".version = "0.16"\n'],
    ['build-dependencies', '[build-dependencies]\ni18n-embed = "0.16"\n'],
    ['target build-dependencies', '[target.\'cfg(unix)\'.build-dependencies]\ni18n-embed-fl = "0.10"\n'],
  ])('cargo-i18n: detected from %s', async (_, cargo) => {
    const { project } = await createTestProject({ 'Cargo.toml': `[package]\nname = "app"\n\n${cargo}` })
    expect(project.explain().presets.find(p => p.name === 'cargo-i18n')?.reason).toBe('detected')
  })

  it('cargo-i18n: a renamed dependency reports its alias', async () => {
    const { project } = await createTestProject({ 'Cargo.toml': '[dependencies]\nfl = { package = "i18n-embed-fl", version = "0.10" }\n' })
    expect(project.explain().presets.find(p => p.name === 'cargo-i18n')?.reason).not.toBe('detected')
  })

  it('vscode-extension: package.nls files and %key% references', async () => {
    const { project } = await createTestProject({
      'package.json': json({
        devDependencies: { '@types/vscode': '*' },
        contributes: {
          commands: [
            { title: '%cmd.open%' },
          ],
        },
      }),
      'package.nls.json': json({ 'cmd.open': 'Open' }),
      'package.nls.de.json': json({ 'cmd.open': 'Öffnen' }),
      'src/extension.ts': `vscode.l10n.t('Hello')`,
    })
    expect(project.locales).toEqual(['en', 'de'])
    expect(project.usages().map(m => m.usage.key)).toContain('cmd.open')
  })

  it('nuxt-i18n: langDir defaults', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@nuxtjs/i18n'),
      'nuxt.config.ts': `export default defineNuxtConfig({ i18n: { langDir: 'locales' } })`,
      'i18n/locales/en.json': json({ hi: 'Hi' }),
      'pages/index.vue': `<template><p>{{ $t('hi') }}</p></template>`,
    })
    expect(project.keys()).toEqual(['hi'])
    expect(project.analyze().unused).toEqual([])
  })

  it('nuxt-i18n: .js and .ts locale files, plain or with defineI18nLocale', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg('@nuxtjs/i18n'),
      'i18n/locales/en.ts': `export default defineI18nLocale(async locale => ({\n  hi: 'Hi',\n}))\n`,
      'i18n/locales/de.js': `export default defineI18nLocale(() => {\n  return {\n    hi: 'Hallo',\n  }\n})\n`,
      'i18n/locales/fr.js': `export default {\n  hi: 'Salut',\n}\n`,
      'pages/index.vue': `<template><p>{{ $t('hi') }}</p></template>`,
    })
    expect(project.locales).toEqual(['en', 'de', 'fr'])
    expect(['en', 'de', 'fr'].map(locale => project.message('hi', locale)?.value)).toEqual(['Hi', 'Hallo', 'Salut'])
    expect(project.analyze().undefinedUsages).toEqual([])
    await write(project, [
      {
        type: 'set',
        key: 'bye',
        locale: 'en',
        value: 'Bye',
      },
    ])
    expect(files.get('i18n/locales/en.ts')).toBe(`export default defineI18nLocale(async locale => ({\n  hi: 'Hi',\n  bye: 'Bye',\n}))\n`)
  })

  it('nuxt-i18n-micro: page messages over global ones', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg('nuxt-i18n-micro', 'nuxt'),
      'nuxt.config.ts': `export default defineNuxtConfig({ i18n: { translationDir: 'i18n' } })`,
      'i18n/en.json': json({ 'link.back': 'Back', 'title': 'Site', 'greet': 'Hi {name}' }),
      'i18n/pages/pageA/en.json': json({ title: 'Page A' }),
      'i18n/pages/products-id/en.json': json({ title: 'Product' }),
      'app/pages/pageA.vue': `<template><a>{{ $t('link.back') }}</a><h2>{{ $t('title') }}</h2></template>`,
      'app/pages/products/[id].vue': `<template><h2>{{ $t('title') }}</h2></template>`,
      'app/components/Hello.vue': `<script setup>\nconst { $t: t } = useNuxtApp()\nconst title = t('title')\n</script>\n<template><i18n-t keypath="greet" /></template>`,
    })
    expect(project.explain().presets.find(p => p.name === 'nuxt-i18n-micro')?.reason).toBe('detected')
    expect(project.keys()).toEqual([
      'greet',
      'link.back',
      'pages.pageA.title',
      'pages.products-id.title',
      'title',
    ])
    expect(project.usages().map(m => `${m.usage.path}:${m.usage.key}`)).toEqual([
      'app/components/Hello.vue:title',
      'app/components/Hello.vue:greet',
      'app/pages/pageA.vue:link.back',
      'app/pages/pageA.vue:pages.pageA.title',
      'app/pages/products/[id].vue:pages.products-id.title',
    ])
    const analysis = project.analyze()
    expect(analysis.unused).toEqual([])
    expect(analysis.undefinedUsages).toEqual([])

    files.set('i18n/pages/pageA/en.json', json({ 'title': 'Page A', 'link.back': 'Home' }))
    await project.update([
      { type: 'change', path: 'i18n/pages/pageA/en.json' },
    ])
    expect(project.usages({ path: 'app/pages/pageA.vue' }).map(m => m.usage.key)).toEqual(['pages.pageA.link.back', 'pages.pageA.title'])
  })

  it('nuxt-i18n-micro: route names and dynamic keys', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('nuxt-i18n-micro', 'nuxt'),
      'locales/en.json': json({
        title: 'Site',
        list: { a: 'A' },
      }),
      'locales/pages/about/en.json': json({
        title: 'About',
        items: { a: 'A' },
      }),
      'pages/(marketing)/about.vue': `<script setup>\nconst { $t } = useI18n()\n$t(\`items.\${id}\`)\n$t(\`list.\${id}\`)\n</script>\n<template>{{ $t('title') }}</template>`,
      'components/pages/about.vue': `<template>{{ $t('title') }}</template>`,
    })
    expect(project.usages().map(m => `${m.usage.path}:${m.usage.key}`)).toEqual([
      'components/pages/about.vue:title',
      'pages/(marketing)/about.vue:pages.about.items.',
      'pages/(marketing)/about.vue:list.',
      'pages/(marketing)/about.vue:pages.about.title',
    ])
  })

  it('i18next: plural suffixes count as the base key', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('i18next'),
      'locales/en/translation.json': json({ apple_one: 'apple', apple_other: 'apples', greet: 'Hi {{name}}' }),
      'src/a.ts': `i18next.t('apple', { count: 2 }); i18next.t('greet', { name })`,
    })
    expect(project.keys()).toEqual(['translation:apple_one', 'translation:apple_other', 'translation:greet'])
    const analysis = project.analyze()
    expect(analysis.unused).toEqual([])
    expect(analysis.undefinedUsages).toEqual([])
  })

  it('i18next: context, ordinal and plural suffixes stack on the base key', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('i18next'),
      'locales/en/translation.json': json({
        friend_other: 'friends',
        friend_male_one: 'a boyfriend',
        friend_male_other: 'boyfriends',
        place_ordinal_one: '{{count}}st',
        place_ordinal_other: '{{count}}th',
      }),
      'src/a.ts': `i18next.t('friend', { context: 'male', count: 2 }); i18next.t('place', { count: 1, ordinal: true })`,
    })
    const analysis = project.analyze()
    expect(analysis.unused).toEqual([])
    expect(analysis.undefinedUsages).toEqual([])
    expect(project.lookup('translation:friend', 'en')?.value).toBe('friends')
    expect(project.lookup('translation:place', 'en')?.value).toBe('{{count}}th')
  })

  it('i18next: a locale needs only the plural categories whole numbers select', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('i18next'),
      'locales/en/translation.json': json({ apple_one: 'an apple', apple_other: 'apples' }),
      'locales/fr/translation.json': json({ apple_one: 'une pomme', apple_other: 'pommes' }),
      'locales/es/translation.json': json({ apple_one: 'una manzana', apple_other: 'manzanas', apple_many: 'de manzanas' }),
      'src/a.ts': `i18next.t('apple', { count })`,
    })
    const missing = Object.fromEntries(project.analyze().coverage.map(c => [c.locale, c.missing]))
    // French `many` starts at 1,000,000: it is allowed, not required.
    expect(missing).toEqual({ en: [], es: [], fr: [] })
    expect(project.get('translation:apple_many')?.missing).toEqual([])
    expect(project.analyze().diagnostics.filter(d => d.code === 'missing-translation')).toEqual([])
  })

  it('i18next: each locale needs the plural categories of its own language', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('i18next'),
      'locales/en/translation.json': json({
        apple_zero: 'no apples',
        apple_one: 'an apple',
        apple_other: 'apples',
        place_ordinal_one: '1st',
        place_ordinal_other: 'nth',
      }),
      'locales/ja/translation.json': json({ apple_other: 'りんご', place_ordinal_other: '番目' }),
      'locales/ru/translation.json': json({ apple_one: 'яблоко', apple_other: 'яблока', place_ordinal_other: '-й' }),
      'src/a.ts': `i18next.t('apple', { count }); i18next.t('place', { count, ordinal: true })`,
    })
    const missing = Object.fromEntries(project.analyze().coverage.map(c => [c.locale, c.missing]))
    // English has no `zero` category: `apple_zero` is optional. English ordinals have `two` and `few`.
    expect(missing).toEqual({
      en: ['translation:place_ordinal_few', 'translation:place_ordinal_two'],
      ja: [],
      ru: ['translation:apple_few', 'translation:apple_many'],
    })
    expect(project.get('translation:apple_one')?.missing).toEqual([])
    expect(project.lookup('translation:apple', 'ja')?.value).toBe('りんご')

    const diagnostic = project.analyze().diagnostics.find(d => d.code === 'missing-translation' && d.key === 'translation:apple_few')!
    expect(diagnostic.location?.path).toBe('locales/en/translation.json')
    const copy = diagnostic.fixes.find(fix => fix.title === 'Copy the source value')!
    await project.apply(project.plan(copy.ops))
    expect(project.message('translation:apple_few', 'ru')?.value).toBe('apples')
  })

  it('i18next: a locale with one form only shows it', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('i18next'),
      'locales/en/translation.json': json({ apple_one: 'an apple', apple_other: 'apples' }),
      'locales/de/translation.json': json({ apple_one: 'ein Apfel' }),
      'src/a.ts': `i18next.t('apple', { count })`,
    })
    expect(project.lookup('translation:apple', 'de')?.value).toBe('ein Apfel')
  })
})

describe('tier 2 presets', () => {
  it('svelte-i18next: $i18n.t in markup and script, with i18next keys', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('svelte-i18next', 'i18next', 'svelte'),
      'locales/en/translation.json': json({
        title: 'T',
        greet: 'Hi {{name}}',
        apple_one: 'apple',
        apple_other: 'apples',
        unused: 'U',
      }),
      'locales/en/errors.json': json({ notFound: 'Not found' }),
      'src/routes/+page.svelte': [
        '<script>',
        '  import { getContext } from \'svelte\'',
        '  const i18n = getContext("i18n")',
        '  const label = $i18n.t(\'greet\', { name: \'Ada\' })',
        '</script>',
        '<h1 title={$i18n.t(\'errors:notFound\')}>{$i18n.t(\'title\')}</h1>',
        '<p>{$i18n.t(\'apple\', { count: 2 })} {$i18n.t(\'notFound\', { ns: \'errors\' })} {$i18n.t(\'missing\')}</p>',
      ].join('\n'),
    }, {
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
    })
    const detected = project.explain().presets.filter(p => p.reason === 'detected').map(p => p.name)
    expect(detected).toEqual(['svelte-i18next', 'i18next', 'general'])
    expect(project.usages().map(m => m.usage.key)).toEqual([
      'translation:greet',
      'errors:notFound',
      'translation:title',
      'translation:apple',
      'errors:notFound',
      'translation:missing',
    ])
    const analysis = project.analyze()
    expect(analysis.unused).toEqual(['translation:unused'])
    expect(analysis.undefinedUsages.map(u => u.key)).toEqual(['translation:missing'])
  })
})

describe('dotnet-resx', () => {
  const data = (entries: Record<string, string>): string => `<?xml version="1.0" encoding="utf-8"?>
<root>
${Object.entries(entries).map(([name, value]) => `  <data name="${name}" xml:space="preserve">\n    <value>${value}</value>\n  </data>\n`).join('')}</root>
`
  const files = {
    'src/App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web" />',
    'src/App/Resources/SharedResource.resx': data({
      'Hello': 'Hello {0}',
      'Save changes': 'Save changes',
      'Title': 'Title',
      'Nav.Home': 'Home',
    }),
    'src/App/Resources/SharedResource.de.resx': data({ Hello: 'Hallo {0}' }),
    'src/App/Resources/SharedResource.pt-BR.resx': data({ Hello: 'Olá {0}' }),
    'src/App/Resources/Views.Home.Index.resx': data({ Welcome: 'Welcome' }),
    'src/App/Views/Home/Index.cshtml': '@inject IViewLocalizer Localizer\n<h1>@Localizer["Hello", name]</h1>\n<p>@Localizer["Welcome"]</p>',
    'src/App/Pages/Nav.razor': '@inject IStringLocalizer<SharedResource> Loc\n<a>@Loc["Nav.Home"]</a>',
    'src/App/Controllers/HomeController.cs': [
      'var a = _localizer["Save changes"];',
      'var b = localizer.GetString("Title");',
      'var c = Properties.Resources.Hello;',
      'var d = Resources.ResourceManager.GetString(name);',
      'using App.Resources.Shared;',
    ].join('\n'),
  }

  it('detects the project, reads locales from file names and finds usages in .cs, .cshtml and .razor', async () => {
    const { project } = await createTestProject(files)
    expect(project.explain().presets.find(p => p.name === 'dotnet-resx')?.reason).toBe('detected')
    expect(project.locales).toEqual(['en', 'de', 'pt-BR'])
    expect(project.keys()).toEqual([
      'Hello',
      'Nav.Home',
      'Save changes',
      'Title',
      'Welcome',
    ])
    expect(project.usages().map(m => m.usage.key).sort()).toEqual([
      'Hello',
      'Hello',
      'Nav.Home',
      'Save changes',
      'Title',
      'Welcome',
    ])
    expect(project.analyze().unused).toEqual([])
  })

  it('is not detected without a .csproj', async () => {
    const { project } = await createTestProject({
      'Resources/Strings.resx': data({ a: 'A' }),
    })
    expect(project.explain().presets.find(p => p.name === 'dotnet-resx')?.reason).toBe('not-detected')
  })

  it('writes into existing files and creates new locale files next to the source', async () => {
    const { project, files: written } = await createTestProject(files)
    await project.apply(project.plan([
      {
        type: 'set',
        key: 'Title',
        locale: 'de',
        value: 'Titel',
      },
      {
        type: 'set',
        key: 'Title',
        locale: 'fr',
        value: 'Titre',
      },
    ]))
    expect(written.get('src/App/Resources/SharedResource.de.resx')).toBe(data({ Hello: 'Hallo {0}', Title: 'Titel' }))
    expect(written.get('src/App/Resources/SharedResource.fr.resx')).toContain('  <data name="Title" xml:space="preserve">\n    <value>Titre</value>\n  </data>\n</root>\n')
    expect(project.locales).toEqual(['en', 'de', 'fr', 'pt-BR'])
    expect(project.message('Title', 'fr')?.resource).toBe('src/App/Resources/SharedResource.fr.resx')
  })

  it('reads `X.<name>.resx` as a locale only when `X.resx` exists', async () => {
    const { project } = await createTestProject({
      'App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web" />',
      'Resources/Views.Shared.Nav.resx': data({ Home: 'Home' }),
      'Resources/Views.Shared.Nav.de.resx': data({ Home: 'Start' }),
      'Resources/Pages.App.resx': data({ Title: 'App' }),
    })
    expect(project.locales).toEqual(['en', 'de'])
    expect(project.message('Title', 'en')?.resource).toBe('Resources/Pages.App.resx')
    expect(project.message('Home', 'de')?.resource).toBe('Resources/Views.Shared.Nav.de.resx')
  })

  it('compares composite format items, not escaped braces', async () => {
    const { project } = await createTestProject({
      'App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web" />',
      'Strings.resx': data({ Price: '{0:C} for {1,-10} {{literal}}', Hi: 'Hi {name}' }),
      'Strings.de.resx': data({ Price: '{0:N2} für {2} {{other}}', Hi: 'Hallo {name}' }),
    })
    const mismatches = project.analyze().diagnostics.filter(d => d.code === 'placeholder-mismatch')
    expect(mismatches.map(d => d.message)).toEqual(['"Price" in de has different placeholders than en: missing 1; unexpected 2.'])
  })
})

// Cases that i18n-ally-next fixed after the fork of i18n-ally.
describe('namespaces', () => {
  it('react-i18next: folders, keyPrefix, flat dotted keys, Translation and withTranslation', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('react-i18next', 'i18next'),
      'locales/en/translation.json': json({ 'common.stackTrace': 'Stack', 'title': 'T' }),
      'locales/en/errors.json': json({ notFound: 'Not found' }),
      'locales/en/pages/home.json': json({
        title: 'Home',
        foo: {
          bar: { baz: 'B' },
        },
      }),
      'src/A.tsx': [
        `function A() { const { t } = useTranslation(); return t('common.stackTrace') + t('errors:notFound') }`,
        `function B() { const { t } = useTranslation('pages/home', { keyPrefix: 'foo.bar' }); return t('baz') + t('translation:title') }`,
        `function C() { const { t } = useTranslation('pages/home'); return t('title') + t('pages/home:foo.bar.baz') }`,
        `function E() { const { t } = useTranslation(undefined, { keyPrefix: 'common' }); return t('stackTrace') }`,
        `function F() { return <Translation ns="pages/home" keyPrefix="foo.bar">{t => <p>{t('baz')}</p>}</Translation> }`,
      ].join('\n'),
      'src/D.tsx': `function D({ t }) { return t('notFound') }\nexport default withTranslation('errors')(D)\n`,
      'src/G.tsx': `function G({ t }) { return t('baz') }\nexport default withTranslation('pages/home', { keyPrefix: 'foo.bar' })(G)\n`,
    }, {
      resources: [
        { pattern: 'locales/{locale}/{namespaces}.json' },
      ],
      keyStyle: 'flat',
    })
    expect(project.usages().map(m => m.usage.key)).toEqual([
      'translation:common.stackTrace',
      'errors:notFound',
      'pages/home:foo.bar.baz',
      'translation:title',
      'pages/home:title',
      'pages/home:foo.bar.baz',
      'translation:common.stackTrace',
      'pages/home:foo.bar.baz',
      'errors:notFound',
      'pages/home:foo.bar.baz',
    ])
    expect(project.analyze().undefinedUsages).toEqual([])
  })

  it('i18next: a configured default namespace and explicit ones', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('i18next'),
      'locales/en/translation.json': json({ a: 'A' }),
      'locales/en/errors.json': json({ x: 'X' }),
      'src/a.ts': `i18next.t('x'); i18next.t('errors:x'); i18next.t('translation:a')`,
    }, {
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
      namespace: { default: 'errors' },
    })
    expect(project.usages().map(m => m.usage.key)).toEqual(['errors:x', 'errors:x', 'translation:a'])
    expect(project.analyze().undefinedUsages).toEqual([])
  })

  it('i18next: fallbackNS from the init code finds keys missing in the scope namespace', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('react-i18next', 'i18next'),
      'src/i18n.ts': `i18next.init({ defaultNS: 'app', fallbackNS: ['common'] })`,
      'locales/en/app.json': json({ title: 'App', save: 'Save app' }),
      'locales/en/common.json': json({ save: 'Save', delete: 'Delete' }),
      'locales/en/event.json': json({ name: 'Name' }),
      'src/Event.tsx': `const { t } = useTranslation('event'); t('name'); t('delete'); t('nope'); t('app:title')`,
      'src/App.tsx': `const { t } = useTranslation(); t('save'); t('delete')`,
    }, {
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
    })
    expect(project.config.namespace).toMatchObject({
      default: 'app',
      fallback: ['common'],
    })
    expect(project.usages().map(m => m.usage.key)).toEqual([
      'app:save',
      'common:delete',
      'event:name',
      'common:delete',
      'event:nope',
      'app:title',
    ])
    expect(project.analyze().undefinedUsages.map(u => u.key)).toEqual(['event:nope'])
  })

  const i18nextCliConfig = [
    `import { defineConfig } from 'i18next-cli'`,
    `export default defineConfig({`,
    `  locales: ['de', 'en'],`,
    `  extract: {`,
    `    input: ['src/**/*.{ts,tsx}'],`,
    `    output: 'public/locales/{{language}}/{{namespace}}.json',`,
    `    primaryLanguage: 'en',`,
    `    defaultNS: 'app',`,
    `    fallbackNS: 'common',`,
    `    nsSeparator: '|',`,
    `    keySeparator: false,`,
    `    functions: ['t', '*.t', 'translate'],`,
    `    transComponents: ['Trans', 'Message'],`,
    `    useTranslationNames: ['useTranslation', { name: 'useScoped', nsArg: 1 }],`,
    `    ignore: ['src/legacy/**'],`,
    `  },`,
    `})`,
  ].join('\n')

  it('react-i18next: reads the i18next-cli config', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('react-i18next', 'i18next'),
      'i18next.config.ts': i18nextCliConfig,
      'public/locales/en/app.json': json({ 'title': 'App', 'menu.open': 'Open' }),
      'public/locales/en/common.json': json({ save: 'Save' }),
      'public/locales/en/pages/home.json': json({ hello: 'Hello' }),
      'public/locales/de/app.json': json({ title: 'App' }),
      'public/locales/fr/app.json': json({ title: 'App' }),
      'src/App.tsx': [
        `const { t } = useTranslation(); t('menu.open'); t('save'); t('pages/home|hello')`,
        `translate('title'); <Message i18nKey="save" />`,
        `function Home() { const { t } = useScoped('x', 'pages/home'); return t('hello') }`,
      ].join('\n'),
      'src/legacy/old.ts': `translate('gone')`,
    })
    expect(project.config).toMatchObject({
      sourceLocale: 'en',
      locales: ['de', 'en'],
      keyStyle: 'flat',
      resources: [
        { pattern: 'public/locales/{locale}/{namespaces}.json' },
      ],
      namespace: {
        separator: '|',
        default: 'app',
        fallback: ['common'],
      },
    })
    expect(project.config.usage.exclude).toContain('src/legacy/**')
    expect(project.config.usage.calls.filter(spec => spec.callee === 'useTranslation')).toHaveLength(1)
    expect(project.config.usage.calls.find(spec => spec.callee === 'translate')?.params).toMatchObject({
      arg: [1, 2],
    })
    expect(project.usages().map(m => m.usage.key)).toEqual([
      'app:menu.open',
      'common:save',
      'pages/home:hello',
      'app:title',
      'common:save',
      'pages/home:hello',
    ])
    expect(project.analyze().undefinedUsages).toEqual([])
  })

  it('i18next: the x18n config wins over the i18next-cli config', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('i18next'),
      'i18next.config.ts': i18nextCliConfig,
      'locales/de/common.json': json({ save: 'Speichern' }),
    }, {
      sourceLocale: 'de',
      locales: ['de'],
      keyStyle: 'nested',
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
      namespace: { default: 'common', separator: ':' },
    })
    expect(project.config).toMatchObject({
      sourceLocale: 'de',
      locales: ['de'],
      keyStyle: 'nested',
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
      namespace: {
        separator: ':',
        default: 'common',
        fallback: ['common'],
      },
    })
  })

  it('i18next: values of the i18next-cli config that are not literals are skipped', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('i18next'),
      'i18next.config.js': [
        `const locales = process.env.LOCALES.split(',')`,
        `const config = {`,
        `  locales,`,
        `  extract: {`,
        `    output: (language, namespace) => \`locales/\${language}/\${namespace}.json\`,`,
        `    primaryLanguage: process.env.PRIMARY,`,
        `    defaultNS: false,`,
        `    fallbackNS: [getFallback(), 'shared'],`,
        `    functions: [...names, \`tr\`],`,
        `    ...more,`,
        `  },`,
        `}`,
        `module.exports = config`,
      ].join('\n'),
      'locales/en/translation.json': json({ a: 'A' }),
    })
    expect(project.config).toMatchObject({
      sourceLocale: 'en',
      locales: undefined,
      resources: [],
      namespace: {
        default: undefined,
        fallback: ['shared'],
      },
    })
  })

  it('namespace.byFile names the namespace of keys per source folder', async () => {
    const { project } = await createTestProject({
      'locales/en/a.json': json({ productName: 'A' }),
      'locales/en/b.json': json({ productName: 'B' }),
      'a/src/index.js': `t('productName'); t('b:productName')`,
      'b/src/index.js': `t('productName')`,
    }, {
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
      namespace: {
        separator: ':',
        byFile: { 'a/**': 'a', 'b/**': 'b' },
      },
      usage: {
        calls: [
          { callee: 't' },
        ],
      },
    })
    expect(project.usages().map(m => m.usage.key)).toEqual(['a:productName', 'b:productName', 'b:productName'])
    expect(project.analyze().unused).toEqual([])
  })

  it('a custom separator and a hook with a fixed namespace', async () => {
    const { project, files } = await createTestProject({
      'locales/en/shared.json': json({
        type: { bug: 'Bug' },
      }),
      'locales/en/common.json': json({ ok: 'OK' }),
      'src/a.ts': `const { t } = useSharedTranslation(); t('type.bug'); t('common|ok')`,
    }, {
      resources: [
        { pattern: 'locales/{locale}/{namespace}.json' },
      ],
      namespace: { separator: '|' },
      usage: {
        calls: [
          { callee: 'useSharedTranslation', factory: true, namespace: 'shared' },
        ],
      },
    })
    expect(project.usages().map(m => m.usage.key)).toEqual(['shared:type.bug', 'common:ok'])
    expect(project.parseKey('common|ok')).toBe('common:ok')
    await project.apply(project.plan([
      { type: 'rename', from: 'shared:type.bug', to: 'common:bug' },
    ]))
    expect(files.get('src/a.ts')).toBe(`const { t } = useSharedTranslation(); t('common|bug'); t('common|ok')`)
  })

  it('angular-localize: reads angular.json, i18n attributes and $localize', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg('@angular/core', '@angular/localize'),
      'angular.json': json({
        projects: {
          app: {
            i18n: {
              sourceLocale: { code: 'en-GB', subPath: '' },
              locales: {
                tr: 'src/locale/messages.tr.json',
                es: { translation: 'src/locale/messages.es.json' },
              },
            },
            architect: {
              'extract-i18n': {
                options: { format: 'json', outputPath: 'src/locale' },
              },
            },
          },
        },
      }),
      'src/locale/messages.json': json({
        locale: 'en-GB',
        translations: {
          'home.intro': 'Hi, I\'m {$START_LINK}kæm{$CLOSE_LINK}.',
          'nav.blog': 'Blog',
          'title.projects': 'Projects',
          'unused.key': 'Unused',
        },
      }),
      'src/locale/messages.tr.json': json({
        locale: 'tr',
        translations: {
          'home.intro': 'Merhaba, ben {$START_LINK}kæm{$CLOSE_LINK}.',
          'nav.blog': 'Blog',
          'title.projects': 'Projeler',
          'unused.key': 'Kullanılmıyor',
        },
      }),
      'src/locale/messages.es.json': json({
        locale: 'es',
        translations: {
          'home.intro': 'Hola, soy {$START_LINK}kæm.',
          'title.projects': 'Proyectos',
          'unused.key': 'Sin usar',
        },
      }),
      'src/app/home.html': [
        `<p i18n="@@home.intro">Hi, I'm <a routerLink="/kam">kæm</a>.</p>`,
        `<a title="Blog" i18n-title="site menu|Blog link@@nav.blog">Blog</a>`,
        `<p i18n="@@missing.key">Missing</p>`,
      ].join('\n'),
      'src/app/app.routes.ts': `export const routes = [{ path: 'projects', title: $localize\`:@@title.projects:Projects\` }]`,
    })
    expect(project.explain().presets.find(p => p.name === 'angular-localize')?.reason).toBe('detected')
    expect(project.sourceLocale).toBe('en-GB')
    expect([...project.locales].sort()).toEqual(['en-GB', 'es', 'tr'])
    expect(project.keys()).toEqual([
      'home.intro',
      'nav.blog',
      'title.projects',
      'unused.key',
    ])
    expect(project.usages().map(m => m.usage.key).sort()).toEqual([
      'home.intro',
      'missing.key',
      'nav.blog',
      'title.projects',
    ])
    const analysis = project.analyze()
    expect(analysis.unused).toEqual(['unused.key'])
    expect(analysis.undefinedUsages.map(u => u.key)).toEqual(['missing.key'])
    expect(analysis.diagnostics.filter(d => d.code === 'placeholder-mismatch').map(d => [d.key, d.locale])).toEqual([
      ['home.intro', 'es'],
    ])

    await write(project, [
      {
        type: 'set',
        key: 'nav.blog',
        locale: 'es',
        value: 'Blog',
      },
    ])
    expect(JSON.parse(files.get('src/locale/messages.es.json')!)).toEqual({
      locale: 'es',
      translations: {
        'home.intro': 'Hola, soy {$START_LINK}kæm.',
        'title.projects': 'Proyectos',
        'unused.key': 'Sin usar',
        'nav.blog': 'Blog',
      },
    })
  })

  it('angular-localize: XLIFF files and messages without custom ids', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg('@angular/core', '@angular/localize'),
      'angular.json': json({
        projects: {
          app: {
            root: '',
            i18n: {
              locales: { tr: 'src/locale/messages.tr.xlf' },
            },
            architect: {
              'extract-i18n': {
                options: { outputPath: 'src/locale' },
              },
            },
          },
        },
      }),
      'src/locale/messages.xlf': [
        `<?xml version="1.0" encoding="UTF-8" ?>`,
        `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">`,
        `  <file source-language="en-US" datatype="plaintext" original="ng2.template">`,
        `    <body>`,
        `      <trans-unit id="2023484548631819319" datatype="html">`,
        `        <source>Hello world</source>`,
        `      </trans-unit>`,
        `      <trans-unit id="8889534073701065911" datatype="html">`,
        `        <source>Welcome, <x id="INTERPOLATION" equiv-text="{{ name }}"/>!</source>`,
        `      </trans-unit>`,
        `    </body>`,
        `  </file>`,
        `</xliff>`,
        ``,
      ].join('\n'),
      'src/locale/messages.tr.xlf': [
        `<?xml version="1.0" encoding="UTF-8" ?>`,
        `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">`,
        `  <file source-language="en-US" target-language="tr" datatype="plaintext" original="ng2.template">`,
        `    <body>`,
        `      <trans-unit id="2023484548631819319" datatype="html">`,
        `        <source>Hello world</source>`,
        `        <target>Merhaba dünya</target>`,
        `      </trans-unit>`,
        `      <trans-unit id="8889534073701065911" datatype="html">`,
        `        <source>Welcome, <x id="INTERPOLATION" equiv-text="{{ name }}"/>!</source>`,
        `      </trans-unit>`,
        `    </body>`,
        `  </file>`,
        `</xliff>`,
        ``,
      ].join('\n'),
      'src/app/app.html': `<h1 i18n>Hello world</h1>\n<p i18n="site intro|Shown on the home page">Welcome, {{ name }}!</p>`,
    })
    expect(project.sourceLocale).toBe('en-US')
    expect(project.usages().map(m => m.usage.key)).toEqual(['2023484548631819319', '8889534073701065911'])
    expect(project.analyze().unused).toEqual([])
    expect(project.analyze().diagnostics.filter(d => d.code === 'missing-translation').map(d => d.key)).toEqual(['8889534073701065911'])
    await write(project, [
      {
        type: 'set',
        key: '8889534073701065911',
        locale: 'tr',
        value: 'Hoş geldin, {$INTERPOLATION}!',
      },
    ])
    expect(files.get('src/locale/messages.tr.xlf')).toContain('<target>Hoş geldin, <x id="INTERPOLATION" equiv-text="{{ name }}"/>!</target>')
  })

  it('angular-localize: not detected without an i18n block', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@angular/core', '@angular/localize'),
      'angular.json': json({
        projects: { app: {} },
      }),
    })
    expect(project.explain().presets.find(p => p.name === 'angular-localize')?.reason).toBe('not-detected')
  })

  it('ngx-translate: standalone translate() and ternary before pipe', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@angular/core', '@ngx-translate/core'),
      'src/assets/i18n/en.json': json({
        a: { yes: 'Yes', no: 'No' },
        standalone: { key: 'Standalone' },
      }),
      'src/app/app.component.html': `{{ (ok ? 'a.yes' : 'a.no') | translate }}`,
      'src/app/app.component.ts': [
        `import { translate } from '@ngx-translate/core'`,
        `export function label() { return translate('standalone.key') }`,
      ].join('\n'),
    })
    expect(project.explain().presets.find(p => p.name === 'ngx-translate')?.reason).toBe('detected')
    expect(project.usages().map(m => m.usage.key).sort()).toEqual(['a.no', 'a.yes', 'standalone.key'])
    expect(project.analyze().undefinedUsages).toEqual([])
  })

  it('transloco: a kebab-case scope folder is a camelCase key prefix', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg('@jsverse/transloco'),
      'src/assets/i18n/en.json': json({ hello: 'Hello' }),
      'src/assets/i18n/todos-page/en.json': json({ title: 'Todos' }),
      'src/assets/i18n/de.json': json({ hello: 'Hallo' }),
      'src/app/todos.component.html': `<h1>{{ 'todosPage.title' | transloco }}</h1><p>{{ 'hello' | transloco }}</p>`,
    })
    expect(project.keys()).toEqual(['hello', 'todosPage.title'])
    expect(project.analyze().undefinedUsages).toEqual([])
    await project.apply(project.plan([
      {
        type: 'set',
        key: 'todosPage.title',
        locale: 'de',
        value: 'Aufgaben',
      },
    ]))
    expect(JSON.parse(files.get('src/assets/i18n/todos-page/de.json')!)).toEqual({ title: 'Aufgaben' })
  })
})

describe('glossary check', () => {
  it('matches terms as whole words', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({ a: 'Open the workspace', b: 'Workspaces list', c: 'Homepage' }),
      'locales/de.json': json({ a: 'Öffne den Ordner', b: 'Liste', c: 'Startseite' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      glossary: [
        {
          term: 'Workspace',
          translations: { de: 'Arbeitsbereich' },
        },
        {
          term: 'Home',
          translations: { de: 'Start' },
        },
      ],
      checks: { glossary: 'warning' },
    })
    expect(project.analyze().diagnostics.filter(d => d.code === 'glossary').map(d => d.key)).toEqual(['a'])
  })

  it('matches terms inside text written without spaces', async () => {
    const { project } = await createTestProject({
      'locales/ja.json': json({ a: 'ふりがなをフォントに内蔵。', b: 'ふりがなを表示する' }),
      'locales/en.json': json({ a: 'Furigana built into the font.', b: 'Show furigana' }),
      'locales/zh.json': json({ a: '字体内置注音。', b: '显示拼音' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      sourceLocale: 'ja',
      glossary: [
        {
          term: 'ふりがな',
          translations: { en: 'Furigana', zh: '注音' },
        },
      ],
      checks: { glossary: 'warning' },
    })
    expect(project.analyze().diagnostics.filter(d => d.code === 'glossary').map(d => [d.key, d.locale])).toEqual([
      ['b', 'zh'],
    ])
  })

  it('matches a term followed by letters of an unspaced script, and is on by default', async () => {
    const { project } = await createTestProject({
      'locales/en.json': json({ a: 'Connect to x18n', b: 'Open x18n' }),
      'locales/ko.json': json({ a: 'x18n에 연결', b: 'x18nx 열기' }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
      glossary: [
        { term: 'x18n', doNotTranslate: true },
      ],
    })
    expect(project.analyze().diagnostics.filter(d => d.code === 'glossary').map(d => [d.key, d.locale, d.severity])).toEqual([
      ['b', 'ko', 'warning'],
    ])
  })
})

describe('placeholder-mismatch', () => {
  it('skips linked messages and the implicit plural names of vue-i18n', async () => {
    const { project } = await createTestProject({
      'package.json': json({
        dependencies: { 'vue-i18n': '*' },
      }),
      'locales/en.json': json({
        follow: 'Follow back',
        you: 'Follows you',
        days: 'in 0 days|tomorrow|in {n} days',
        hi: 'Hi {name}',
      }),
      'locales/fr.json': json({
        follow: 'Suivre',
        you: '@:follow',
        days: 'dans {v} jours',
        hi: 'Salut',
      }),
    }, {
      resources: [
        { pattern: 'locales/{locale}.json' },
      ],
    })
    const problems = project.analyze().diagnostics.filter(d => d.code === 'placeholder-mismatch').map(d => d.message)
    expect(problems).toEqual([
      '"days" in fr has different placeholders than en: unexpected v.',
      '"hi" in fr has different placeholders than en: missing name.',
    ])
  })
})

describe('param-mismatch', () => {
  it('compares the params of i18next calls with the placeholders of the source message', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('react-i18next'),
      'locales/en/translation.json': json({
        greet: 'Hello {{name}}',
        author: 'By {{author.name}}',
        plain: 'Hello',
        nested: '$t(greet)',
        place_ordinal_one: '{{count}}st',
        items: '{{count}} items',
      }),
      'src/a.tsx': [
        `const { t } = useTranslation()`,
        `t('greet', { nam: 1 })`,
        `t('greet', { name, count: 1, ns: 'translation', defaultValue: 'Hi', context: 'x' })`,
        `t('author', { author })`,
        `t('greet', opts)`,
        `t('greet', { ...opts })`,
        `t('greet', { [k]: 1 })`,
        `t('greet', 'Hello {{name}}', { name })`,
        `t('greet')`,
        `t('plain', { name })`,
        `t('nested', { name })`,
        `t('place', { count: 1, ordinal: true })`,
        `t('items', { count })`,
      ].join('\n'),
    })
    const problems = project.analyze().diagnostics.filter(d => d.code === 'param-mismatch')
    expect(problems.map(d => [d.message, d.severity, d.location?.path])).toEqual([
      ['The params of "translation:greet" differ from its placeholders in en: missing name; unused nam.', 'warning', 'src/a.tsx'],
      ['The params of "translation:greet" differ from its placeholders in en: missing name.', 'warning', 'src/a.tsx'],
    ])
    expect(problems.map(d => project.usages({ key: d.key }).find(m => m.usage.range.start === d.location?.range?.start)?.usage.params)).toEqual([
      ['nam'],
      [],
    ])
  })

  it('reads the default value of a call, which the missing-key fix writes', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('i18next'),
      'locales/en/translation.json': json({}),
      'src/a.ts': `i18next.t('a', 'Default A'); i18next.t('b', { defaultValue: 'Default B', n }); i18next.t('c', 'Default C', { n }); i18next.t('d', { defaultValue: x })`,
    })
    expect(project.usages().map(m => m.usage.defaultValue)).toEqual([
      'Default A',
      'Default B',
      'Default C',
      undefined,
    ])
    for (const diagnostic of project.analyze().diagnostics.filter(d => d.code === 'missing-key'))
      await project.apply(project.plan(diagnostic.fixes[0]!.ops))
    expect(['a', 'b', 'c', 'd'].map(key => project.message(`translation:${key}`, 'en')?.value)).toEqual([
      'Default A',
      'Default B',
      'Default C',
      '',
    ])
  })
})

describe('vue-i18n <i18n src> blocks', () => {
  it('reads every locale of the referenced file and writes edits to it', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg('vue-i18n'),
      'src/components/Hello.vue': `<script setup>\nconst { t } = useI18n()\n</script>\n<template><p>{{ t('hello') }}</p></template>\n<i18n src="./Hello.i18n.json"></i18n>\n`,
      'src/components/Hello.i18n.json': json({
        en: { hello: 'Hello' },
        de: { hello: 'Hallo' },
      }),
    })
    expect(project.locales).toEqual(['en', 'de'])
    expect(project.message('hello', 'de')?.value).toBe('Hallo')
    expect(project.analyze().undefinedUsages).toEqual([])
    await write(project, [
      {
        type: 'set',
        key: 'bye',
        locale: 'de',
        value: 'Tschüss',
      },
    ])
    await write(project, [
      {
        type: 'set',
        key: 'hello',
        locale: 'en',
        value: 'Hi',
      },
    ])
    expect(JSON.parse(files.get('src/components/Hello.i18n.json')!)).toEqual({
      en: { hello: 'Hi' },
      de: { hello: 'Hallo', bye: 'Tschüss' },
    })
    expect(project.analyze().diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(files.get('src/components/Hello.vue')).toContain('<i18n src="./Hello.i18n.json"></i18n>')
  })

  it('keeps reading every block after an edit moves them', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg('vue-i18n'),
      'src/Hello.vue': `<template><p>{{ $t('a') }}</p></template>\n<i18n locale="en">{ "a": "A" }</i18n>\n<i18n locale="de">{ "a": "B" }</i18n>\n`,
    })
    await write(project, [
      {
        type: 'set',
        key: 'a',
        locale: 'en',
        value: 'A longer value',
      },
    ])
    expect(files.get('src/Hello.vue')).toContain('<i18n locale="de">{ "a": "B" }</i18n>')
    expect(['en', 'de'].map(locale => project.message('a', locale)?.value)).toEqual(['A longer value', 'B'])
  })

  it('takes the locale attribute and the format from the src extension', async () => {
    const { project, files } = await createTestProject({
      'package.json': pkg('vue-i18n'),
      'src/Hello.vue': `<template><p>{{ $t('hello') }}</p></template>\n<i18n locale="en" src="../messages/hello.en.yaml"></i18n>\n`,
      'messages/hello.en.yaml': 'hello: Hello\n',
    })
    expect(project.message('hello', 'en')?.value).toBe('Hello')
    expect(project.analyze().undefinedUsages).toEqual([])
    await write(project, [
      {
        type: 'set',
        key: 'hello',
        locale: 'en',
        value: 'Hi',
      },
    ])
    expect(files.get('messages/hello.en.yaml')).toBe('hello: Hi\n')
  })

  it('reads src file names with # and ?', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('vue-i18n'),
      'src/Hello.vue': `<template><p>{{ $t('a') }}{{ $t('b') }}</p></template>\n<i18n locale="en" src="./a#1.json"></i18n>\n<i18n locale="de" src="./b?raw.json"></i18n>\n`,
      'src/a#1.json': json({ a: 'A' }),
      'src/b?raw.json': json({ b: 'B' }),
    })
    expect(project.message('a', 'en')?.value).toBe('A')
    expect(project.message('b', 'de')?.value).toBe('B')
  })

  it('skips a src above the project root or in a format blocks cannot hold', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('vue-i18n'),
      'src/Hello.vue': `<i18n src="../../a.json"></i18n>\n<i18n src="./messages.ts"></i18n>\n`,
      'a.json': json({
        en: { a: 'A' },
      }),
      'src/messages.ts': `export default { en: { a: 'A' } }\n`,
    })
    expect(project.keys()).toEqual([])
    expect(project.analyze().diagnostics.filter(d => d.severity === 'error')).toEqual([])
  })
})

describe('gravity-ui-i18n', () => {
  const keys = (project: Project): (string | undefined)[] => project.usages().map(m => m.usage.key)

  it('reads keyset folders, bound and keyset helpers', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@gravity-ui/i18n', 'react'),
      'src/i18n-keysets/common/en.json': json({ hello: 'Hello {{name}}', started: 'Started' }),
      'src/i18n-keysets/common/ru.json': json({ hello: 'Привет' }),
      'src/i18n-keysets/page.home/en.json': json({
        title: 'Home',
        seconds: { one: '{{count}} second', other: '{{count}} seconds' },
      }),
      'src/components/Header/i18n/en.json': json({ label: 'Label' }),
      'src/App.jsx': [
        'const i18nCommon = i18n.bind(null, \'common\')',
        'const t = i18n.keyset(\'Header\')',
        'i18nCommon(\'hello\', { name }); i18n.i18n(\'page.home\', \'title\'); i18nInstance.i18n(\'page.home\', \'seconds\', { count }); t(\'label\')',
      ].join('\n'),
    })
    expect(project.explain().presets.filter(p => p.reason === 'detected').map(p => p.name)).toContain('gravity-ui-i18n')
    expect(project.locales).toEqual(['en', 'ru'])
    expect(project.keys()).toEqual([
      'Header.label',
      'common.hello',
      'common.started',
      'page.home.seconds.one',
      'page.home.seconds.other',
      'page.home.title',
    ])
    expect(keys(project)).toEqual([
      'common.hello',
      'page.home.title',
      'page.home.seconds',
      'Header.label',
    ])
    const analysis = project.analyze()
    expect(analysis.unused).toEqual(['common.started'])
    expect(analysis.diagnostics.map(d => `${d.code}:${d.key}`)).toContain('placeholder-mismatch:common.hello')
  })

  it('reads every keyset from one file per locale', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@gravity-ui/i18n'),
      'src/i18n/en.json': json({
        wizard: { 'label_no-access': 'No access' },
        Button: { label: 'Label' },
      }),
      'src/index.js': 'const i18n = new I18N()\nconst keyset = i18n.keyset(\'wizard\')\nkeyset(\'label_no-access\')',
      // A module-level keyset function named `i18n` takes the key first.
      'src/Button.js': 'const i18n = i18nInstance.keyset(\'Button\')\ni18n(\'label\', \'x\')',
    })
    expect(keys(project)).toEqual(['Button.label', 'wizard.label_no-access'])
    expect(project.analyze().unused).toEqual([])
  })

  it('leaves a key dynamic when its keyset is no literal', async () => {
    const { project } = await createTestProject({
      'package.json': pkg('@gravity-ui/i18n'),
      'src/i18n/en.json': json({
        page: { title: 'Title' },
      }),
      'src/index.js': 'i18n.i18n(getKeyset(), \'title\'); i18n.i18n(`page`, \'title\')',
    })
    expect(project.usages().map(m => [m.usage.key, m.usage.dynamic])).toEqual([
      [undefined, 'unknown'],
      [undefined, 'unknown'],
    ])
    expect(project.analyze().undefinedUsages).toEqual([])
  })
})
