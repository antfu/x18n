import type { ExtractTemplate, PluginFile, RegexScannerSpec, ResourceSpec, ReviewComment, ReviewType, SerializableConfig } from '@x18n/core'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { yamlReviewStore } from '@x18n/builtins/reviews'
import { hashText } from '@x18n/core'
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export interface MigrationFile {
  /** Path relative to the project root. */
  readonly path: string
  readonly content: string
}

export interface MigrationResult {
  readonly files: readonly MigrationFile[]
  /** What was dropped or needs attention, for the report. */
  readonly notes: readonly string[]
  /** i18n-ally settings that can be removed after the migration. */
  readonly removable: readonly string[]
}

export interface MigrateOptions {
  readonly format?: 'ts' | 'yml' | 'json' | undefined
}

type Settings = ReadonlyMap<string, unknown>

const frameworkPresets: Readonly<Record<string, string>> = {
  'vue': 'vue-i18n',
  'vue-sfc': 'vue-i18n',
  'vuex': 'vue-i18n',
  'nuxt': 'nuxt-i18n',
  'react': 'react-intl',
  'react-i18next': 'react-i18next',
  'next-i18next': 'react-i18next',
  'i18next': 'i18next',
  'i18next-shopify': 'i18next-shopify',
  'next-intl': 'next-intl',
  'next-international': 'next-international',
  'next-translate': 'next-translate',
  'svelte': 'svelte-i18n',
  'vscode': 'vscode-extension',
  'ngx-translate': 'ngx-translate',
  'transloco': 'transloco',
  'flutter': 'flutter',
  'ember': 'ember-intl',
  'i18n-tag': 'i18n-tag',
  'fluent-vue': 'fluent-vue',
  'fluent-vue-sfc': 'fluent-vue',
  'php-joomla': 'php-joomla',
  'php-gettext': 'php-gettext',
  'laravel': 'laravel',
  'chrome-ext': 'chrome-extension',
  'ruby-rails': 'ruby-rails',
  'polyglot': 'polyglot',
  'globalize': 'globalize',
  'ui5': 'ui5',
  'lingui': 'lingui',
  'jekyll': 'jekyll',
  'i18n-js': 'ruby-i18n-js',
}

const languageExtensions: Readonly<Record<string, readonly string[]>> = {
  javascript: ['js', 'mjs', 'cjs'],
  typescript: ['ts', 'mts', 'cts'],
  javascriptreact: ['jsx'],
  typescriptreact: ['tsx'],
  vue: ['vue'],
  html: ['html'],
  svelte: ['svelte'],
  php: ['php'],
  blade: ['blade.php'],
  ruby: ['rb'],
  erb: ['erb'],
  dart: ['dart'],
  json: ['json'],
  yaml: ['yml', 'yaml'],
  handlebars: ['hbs'],
}

const keygenStyles: Readonly<Record<string, 'camel' | 'snake' | 'kebab' | 'dot'>> = {
  'camelCase': 'camel',
  'snake_case': 'snake',
  'kebab-case': 'kebab',
}

const editorSettings: Readonly<Record<string, string>> = {
  'annotations': 'x18n.annotations',
  'annotationInPlace': 'x18n.annotationInPlace',
  'annotationInPlaceFullMatch': 'x18n.annotationInPlaceFullMatch',
  'annotationMaxLength': 'x18n.annotationMaxLength',
  'displayLanguage': 'x18n.displayLocale',
  'showFlags': 'x18n.showFlags',
  'theme.annotation': 'x18n.theme.annotation',
  'theme.annotationMissing': 'x18n.theme.annotationMissing',
  'theme.annotationBorder': 'x18n.theme.annotationBorder',
  'theme.annotationMissingBorder': 'x18n.theme.annotationMissingBorder',
  'theme.annotationInPlaceFullMatch': 'x18n.theme.annotationInPlaceFullMatch',
}

const handledByDefaults = [
  'readonly',
  'encoding',
  'fullReloadOnChanged',
  'includeSubfolders',
  'ignoreFiles',
  'editor.preferEditor',
  'annotationDelimiter',
  'languageTagSystem',
  'targetPickingStrategy',
  'extract.targetPickingStrategy',
]

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, 'utf8').catch(() => undefined)
}

/** The first of `paths` that exists; the i18n-ally-next name comes first. */
async function readFirst(root: string, paths: readonly string[]): Promise<{ path: string, text: string } | undefined> {
  for (const path of paths) {
    const text = await readText(join(root, path))
    if (text !== undefined)
      return { path, text }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStrings(value: unknown): string[] {
  return (Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value]).filter((v): v is string => typeof v === 'string')
}

/** Setting prefixes by priority: the i18n-ally-next fork renames `i18n-ally.*` keys, so its value is the newest. */
const settingPrefixes = ['i18n-ally-next', 'i18n-ally', 'vue-i18n-ally']

/** `i18n-ally-next.*`, `i18n-ally.*` and legacy `vue-i18n-ally.*` keys from `.vscode/settings.json` and `*.code-workspace` files. */
async function readSettings(root: string): Promise<{ settings: Map<string, unknown>, keys: string[] }> {
  const settings = new Map<string, unknown>()
  const ranks = new Map<string, number>()
  const keys: string[] = []
  const sources: unknown[] = []
  const vscode = await readText(join(root, '.vscode/settings.json'))
  if (vscode !== undefined)
    sources.push(parseJsonc(vscode))
  for (const file of await readdir(root).catch(() => [])) {
    if (file.endsWith('.code-workspace')) {
      const data: unknown = parseJsonc(await readText(join(root, file)) ?? '{}')
      if (isRecord(data))
        sources.push(data.settings)
    }
  }
  for (const source of sources) {
    if (!isRecord(source))
      continue
    for (const [key, value] of Object.entries(source)) {
      const match = /^(i18n-ally-next|i18n-ally|vue-i18n-ally)\.(.+)$/.exec(key)
      if (!match)
        continue
      keys.push(key)
      const rank = settingPrefixes.indexOf(match[1]!)
      if (rank < (ranks.get(match[2]!) ?? Infinity)) {
        settings.set(match[2]!, value)
        ranks.set(match[2]!, rank)
      }
    }
  }
  return { settings, keys }
}

/** `localesPaths` + `pathMatcher` + `dirStructure` + `namespace` as resource patterns with the same tokens. */
function resourcesOf(settings: Settings, executed: boolean): ResourceSpec[] {
  const paths = asStrings(settings.get('localesPaths')).map(path => path.replace(/^\.\//, '').replace(/\/$/, ''))
  const matcher = settings.get('pathMatcher')
  const structure = settings.get('dirStructure')
  const namespace = settings.get('namespace') === true
  const patterns = paths.flatMap((dir) => {
    if (typeof matcher === 'string')
      return [`${dir}/${matcher}`]
    if (structure === 'file')
      return [`${dir}/{locale}.{ext}`]
    if (structure === 'dir') {
      return [
        namespace
          ? `${dir}/{locale}/{namespaces}.{ext}`
          : `${dir}/{locale}/**/*.{ext}`,
      ]
    }
    return [
      `${dir}/{locale}.{ext}`,
      namespace
        ? `${dir}/{locale}/{namespaces}.{ext}`
        : `${dir}/{locale}/**/*.{ext}`,
    ]
  })
  return patterns.map(pattern => executed && /\.(?:[jt]s|\{ext\})$/.test(pattern)
    ? { pattern, execute: true }
    : { pattern })
}

function templatesOf(value: unknown): ExtractTemplate[] {
  return (Array.isArray(value)
    ? value
    : []).flatMap((entry): ExtractTemplate[] => {
    if (typeof entry === 'string') {
      return [
        {
          template: entry.replace(/\$1/g, '{key}'),
        },
      ]
    }
    if (!isRecord(entry))
      return []
    const files = asStrings(entry.include)
    return asStrings(entry.templates ?? entry.template).map(template => ({
      template: template.replace(/\$1/g, '{key}'),
      ...files.length
        ? { files }
        : {},
    }))
  })
}

function flagOf(country: string): string {
  return String.fromCodePoint(...[
    ...country.toUpperCase(),
  ].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
}

interface PluginParts {
  regex: RegexScannerSpec[]
  scopes: string | undefined
  templates: ExtractTemplate[]
  localeInfo: Record<string, { flag: string }>
  exclusive: boolean
}

/** `.vscode/i18n-ally-custom-framework.yml` into YAML plugin parts. */
function customFramework(data: unknown, parts: PluginParts): void {
  if (!isRecord(data))
    return
  const extensions = asStrings(data.languageIds).flatMap(id => languageExtensions[id] ?? [id])
  const patterns = asStrings(data.usageMatchRegex)
  if (patterns.length) {
    parts.regex.push({
      extensions: extensions.length
        ? extensions
        : ['js', 'jsx', 'ts', 'tsx', 'vue'],
      patterns,
    })
  }
  const scope = asStrings(data.scopeRangeRegex)[0]
  if (scope)
    parts.scopes = scope
  parts.templates.push(...templatesOf(data.refactorTemplates))
  if (data.monopoly === true)
    parts.exclusive = true
}

function configFile(config: SerializableConfig, format: 'ts' | 'yml' | 'json'): MigrationFile {
  if (format === 'yml')
    return { path: 'x18n.config.yml', content: `# yaml-language-server: $schema=https://x18n.dev/schema/config.json\n${stringifyYaml(config)}` }
  if (format === 'json')
    return { path: 'x18n.config.json', content: `${JSON.stringify({ $schema: 'https://x18n.dev/schema/config.json', ...config }, null, 2)}\n` }
  const body = JSON.stringify(config, null, 2).replace(/"([a-z_$][\w$]*)":/gi, '$1:').replace(/'/g, '\\\'').replace(/"/g, '\'')
  return { path: 'x18n.config.ts', content: `import { defineConfig } from '@x18n/core'\n\n// Migrated from i18n-ally by \`x18n migrate i18n-ally\`.\nexport default defineConfig(${body})\n` }
}

interface Reader {
  readonly get: (key: string) => unknown
  readonly str: (key: string) => string | undefined
  readonly num: (key: string) => number | undefined
  readonly list: (key: string) => string[]
  readonly pick: <T extends string>(key: string, values: readonly T[]) => T | undefined
}

function readerOf(settings: Settings): Reader {
  const get = (key: string): unknown => settings.get(key)
  return {
    get,
    str: (key) => {
      const value = get(key)
      return typeof value === 'string'
        ? value
        : undefined
    },
    num: (key) => {
      const value = get(key)
      return typeof value === 'number'
        ? value
        : undefined
    },
    list: key => asStrings(get(key)),
    pick: (key, values) => values.find(value => value === get(key)),
  }
}

function formatsOf(r: Reader): Record<string, string> {
  const formats: Record<string, string> = {}
  for (const parser of r.list('enabledParsers')) {
    formats[parser === 'yaml'
      ? 'yml'
      : parser] = parser
  }
  const extend = r.get('parsers.extendFileExtensions')
  if (isRecord(extend)) {
    for (const [ext, parser] of Object.entries(extend)) {
      if (typeof parser === 'string')
        formats[ext.replace(/^\./, '')] = parser
    }
  }
  return formats
}

function extractOf(r: Reader): NonNullable<SerializableConfig['extract']> {
  const keygen = r.pick('extract.keygenStrategy', ['slug', 'random', 'empty', 'source'] as const)
  const keyCase = keygenStyles[r.str('extract.keygenStyle') ?? '']
  const byFiles = r.get('extract.ignoredByFiles')
  return {
    ...keygen
      ? { keygen }
      : {},
    ...keyCase
      ? { keyCase }
      : {},
    ...r.str('extract.keyPrefix')
      ? {
          keyPrefix: r.str('extract.keyPrefix'),
        }
      : {},
    ...r.num('extract.keyMaxLength') !== undefined
      ? {
          keyMaxLength: r.num('extract.keyMaxLength'),
        }
      : {},
    ...r.list('extract.ignored').length
      ? {
          ignore: r.list('extract.ignored'),
        }
      : {},
    ...isRecord(byFiles)
      ? {
          ignoreByFile: Object.fromEntries(Object.entries(byFiles).map(([glob, list]) => [
            glob,
            asStrings(list),
          ])),
        }
      : {},
    ...r.get('extract.autoDetect') === true
      ? { autoDetect: true }
      : {},
  }
}

function writeOf(r: Reader): SerializableConfig['write'] {
  const sort = r.get('sortKeys') === true
    ? (r.get('sortCompare') === 'locale'
        ? 'locale'
        : 'binary')
    : undefined
  const indent = r.get('tabStyle') === 'tab'
    ? 'tab'
    : r.num('indent')
  const keepFilled = r.get('keepFulfilled') === true
  if (!sort && indent === undefined && !keepFilled)
    return undefined
  return {
    ...sort
      ? { sort }
      : {},
    ...indent !== undefined
      ? { indent }
      : {},
    ...keepFilled
      ? { keepFilled }
      : {},
  }
}

function presetsOf(r: Reader, notes: string[]): string[] {
  return r.list('enabledFrameworks').flatMap((id) => {
    if (id === 'general' || id === 'custom')
      return []
    const preset = frameworkPresets[id]
    if (!preset)
      notes.push(`Framework "${id}" has no built-in preset yet; it was left out.`)
    return preset
      ? [preset]
      : []
  })
}

function notesOf(settings: Settings, notes: string[]): void {
  if ([
    ...settings.keys(),
  ].some(key => key.startsWith('translate.'))) {
    notes.push('`translate.*` settings were dropped: x18n writes translate prompts instead (`x18n prompt translate --to <locale>`).')
  }
  if (settings.has('review.removeCommentOnResolved'))
    notes.push('`i18n-ally.review.removeCommentOnResolved` was dropped: x18n keeps resolved reviews and hides them with `x18n review list --open`.')
  for (const key of handledByDefaults) {
    if (settings.has(key))
      notes.push(`\`i18n-ally.${key}\` is handled by defaults or dropped.`)
  }
}

function mapConfig(settings: Settings, parts: PluginParts, notes: string[]): SerializableConfig {
  const r = readerOf(settings)
  const presets = presetsOf(r, notes)
  const formats = formatsOf(r)
  const executed = r.get('parsers.typescript.compilerOptions') !== undefined || r.get('parsers.typescript.tsNodePath') !== undefined
  if (executed)
    notes.push('JS/TS locale files were executed by i18n-ally; their patterns get `execute: true` and become read-only.')
  // `disablePathParsing` keeps `.` inside keys, which is a literal key separator.
  const literalKeys = r.get('disablePathParsing') === true
  const keyStyle = r.pick('keystyle', ['flat', 'nested'] as const)
  const usage = {
    ...r.list('keysInUse').length
      ? {
          keysInUse: r.list('keysInUse'),
        }
      : {},
    ...r.list('usage.derivedKeyRules').length
      ? {
          derivedKeys: r.list('usage.derivedKeyRules'),
        }
      : {},
    ...r.list('usage.scanningIgnore').length
      ? {
          exclude: r.list('usage.scanningIgnore'),
        }
      : {},
  }
  const extract = extractOf(r)
  const write = writeOf(r)
  parts.templates.push(...templatesOf(r.get('refactor.templates')))
  const regexPatterns = [
    ...r.list('regex.usageMatch'),
    ...r.list('regex.usageMatchAppend'),
  ]
  if (regexPatterns.length) {
    parts.regex.push({
      extensions: [
        'js',
        'jsx',
        'ts',
        'tsx',
        'vue',
        'html',
        'svelte',
      ],
      patterns: regexPatterns,
    })
  }
  const countries = r.get('localeCountryMap')
  if (isRecord(countries)) {
    for (const [locale, country] of Object.entries(countries)) {
      if (typeof country === 'string' && /^[a-z]{2}$/i.test(country)) {
        parts.localeInfo[locale] = {
          flag: flagOf(country),
        }
      }
    }
  }
  notesOf(settings, notes)
  const resources = resourcesOf(settings, executed)
  return {
    ...r.str('sourceLanguage')
      ? {
          sourceLocale: r.str('sourceLanguage'),
        }
      : {},
    ...r.list('ignoredLocales').length
      ? {
          ignoreLocales: r.list('ignoredLocales'),
        }
      : {},
    ...presets.length || parts.exclusive
      ? {
          presets: parts.exclusive
            ? []
            : presets,
        }
      : {},
    ...resources.length
      ? { resources }
      : {},
    ...Object.keys(formats).length
      ? { formats }
      : {},
    ...keyStyle
      ? { keyStyle }
      : {},
    ...literalKeys
      ? { keySeparator: false }
      : {},
    ...r.str('defaultNamespace')
      ? {
          namespace: {
            default: r.str('defaultNamespace'),
          },
        }
      : {},
    ...Object.keys(usage).length
      ? { usage }
      : {},
    ...write
      ? { write }
      : {},
    ...Object.keys(extract).length
      ? { extract }
      : {},
    ...reviewOf(r),
  }
}

function reviewOf(r: Reader): Pick<SerializableConfig, 'review'> {
  const enabled = r.get('review.enabled')
  const author = {
    ...r.str('review.user.name') && {
      name: r.str('review.user.name'),
    },
    ...r.str('review.user.email') && {
      email: r.str('review.user.email'),
    },
  }
  const review = {
    ...typeof enabled === 'boolean' && { enabled },
    ...Object.keys(author).length > 0 && { author },
  }
  return Object.keys(review).length > 0
    ? { review }
    : {}
}

const reviewTypes: Readonly<Record<string, ReviewType>> = {
  comment: 'comment',
  approve: 'approve',
  request_change: 'request-change',
}

function str(value: unknown): string | undefined {
  return typeof value === 'string'
    ? value
    : undefined
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value)
    ? value
    : {}
}

/** One i18n-ally comment; one with a `suggestion` becomes a suggestion. */
function convertComment(comment: Record<string, unknown>): ReviewComment {
  const user = recordOf(comment.user)
  const name = str(user.name)
  const email = str(user.email)
  const text = str(comment.comment)
  const suggestion = str(comment.suggestion)
  return {
    id: str(comment.id) ?? hashText(JSON.stringify(comment)).slice(0, 6),
    type: suggestion === undefined
      ? reviewTypes[str(comment.type) ?? 'comment'] ?? 'comment'
      : 'suggestion',
    ...(name !== undefined || email !== undefined) && {
      author: {
        ...name !== undefined && { name },
        ...email !== undefined && { email },
      },
    },
    time: str(comment.time) ?? new Date(0).toISOString(),
    ...text !== undefined && { text },
    ...suggestion !== undefined && { suggestion },
    ...comment.resolved === true && { resolved: true },
  }
}

/** The comments of one key and locale, with the translation candidate as a last suggestion. */
function convertLocale(key: string, locale: string, item: Record<string, unknown>): ReviewComment[] {
  const comments = (Array.isArray(item.comments)
    ? item.comments
    : []).filter(isRecord).map(convertComment)
  const candidate = recordOf(item.translation_candidate)
  const text = str(candidate.text)
  if (text !== undefined) {
    comments.push({
      id: hashText(`${key}:${locale}:${text}`).slice(0, 6),
      type: 'suggestion',
      time: str(candidate.time) ?? new Date(0).toISOString(),
      text: 'Translation candidate from i18n-ally',
      suggestion: text,
    })
  }
  return comments
}

/** i18n-ally's `reviews.<key>.locales.<locale>.comments` as x18n threads; translation candidates become suggestions. */
function convertI18nAllyReviews(text: string, notes: string[]): string {
  const reviews = recordOf(recordOf(parseYaml(text)).reviews)
  const threads: Record<string, Record<string, ReviewComment[]>> = {}
  let descriptions = 0
  for (const [key, entry] of Object.entries(reviews)) {
    const { description, locales } = recordOf(entry)
    if (description !== undefined)
      descriptions++
    for (const [locale, item] of Object.entries(recordOf(locales))) {
      const comments = convertLocale(key, locale, recordOf(item))
      if (comments.length > 0)
        (threads[key] ??= {})[locale] = comments
    }
  }
  if (descriptions > 0) {
    notes.push(`${descriptions} key description${descriptions === 1
      ? ' was'
      : 's were'} dropped: x18n reviews have no key descriptions.`)
  }
  return yamlReviewStore.serialize({ threads, sources: {} })
}

export interface I18nAllyConfig {
  /** The x18n config the settings mean. */
  readonly config: SerializableConfig
  /** Custom regexes, scopes, templates and flags, as a YAML plugin. */
  readonly plugin: PluginFile | undefined
  readonly notes: readonly string[]
  /** The `i18n-ally.*` settings keys that were read. */
  readonly keys: readonly string[]
  /** Path of the custom framework file that was read. */
  readonly customFramework: string | undefined
}

/** The x18n config that a project's i18n-ally settings and custom framework mean, or undefined without any. */
export async function readI18nAllyConfig(root: string): Promise<I18nAllyConfig | undefined> {
  const { settings, keys } = await readSettings(root)
  return configOf(root, settings, keys)
}

async function configOf(root: string, settings: Settings, keys: readonly string[]): Promise<I18nAllyConfig | undefined> {
  const custom = await readFirst(root, ['.vscode/i18n-ally-next-custom-framework.yml', '.vscode/i18n-ally-custom-framework.yml'])
  const customText = custom?.text
  if (keys.length === 0 && customText === undefined)
    return undefined
  const notes: string[] = []
  const parts: PluginParts = {
    regex: [],
    scopes: undefined,
    templates: [],
    localeInfo: {},
    exclusive: false,
  }
  if (customText !== undefined)
    customFramework(parseYaml(customText), parts)
  const config = mapConfig(settings, parts, notes)
  if (parts.exclusive)
    notes.push('The custom framework was exclusive (`monopoly`), so built-in presets are turned off (`presets: []`).')
  const needsPlugin = parts.regex.length > 0 || parts.scopes !== undefined || parts.templates.length > 0 || Object.keys(parts.localeInfo).length > 0
  const plugin: PluginFile | undefined = needsPlugin
    ? {
        name: 'custom',
        ...parts.regex.length
          ? {
              scanners: { regex: parts.regex },
            }
          : {},
        ...parts.scopes
          ? {
              scopes: { regex: parts.scopes },
            }
          : {},
        ...parts.templates.length
          ? {
              extract: { templates: parts.templates },
            }
          : {},
        ...Object.keys(parts.localeInfo).length
          ? { localeInfo: parts.localeInfo }
          : {},
      }
    : undefined
  return {
    config,
    plugin,
    notes,
    keys,
    customFramework: custom?.path,
  }
}

/** Converts i18n-ally settings, custom framework and reviews into x18n files. Never deletes i18n-ally files. */
export async function migrateI18nAlly(root: string, options: MigrateOptions = {}): Promise<MigrationResult> {
  const { settings, keys } = await readSettings(root)
  const found = await configOf(root, settings, keys)
  if (!found) {
    return {
      files: [],
      notes: ['No i18n-ally settings found.'],
      removable: [],
    }
  }
  const { config, plugin } = found
  const notes = [...found.notes]
  const reviews = await readFirst(root, ['.vscode/i18n-ally-next-reviews.yml', '.vscode/i18n-ally-reviews.yml'])
  const files: MigrationFile[] = []
  const needsPlugin = plugin !== undefined
  const finalConfig: SerializableConfig = needsPlugin
    ? {
        ...config,
        plugins: ['./.x18n/custom.x18n-plugin.yml'],
      }
    : config
  files.push(configFile(finalConfig, options.format ?? 'ts'))
  if (plugin)
    files.push({ path: '.x18n/custom.x18n-plugin.yml', content: `# yaml-language-server: $schema=../node_modules/@x18n/core/schema/plugin.json\n${stringifyYaml(plugin)}` })

  // Editor UX settings stay in VS Code; they never override the config.
  const vscodePath = join(root, '.vscode/settings.json')
  let vscodeText = await readText(vscodePath)
  if (vscodeText !== undefined) {
    let changed = false
    for (const [from, to] of Object.entries(editorSettings)) {
      if (settings.has(from)) {
        vscodeText = applyEdits(vscodeText, modify(vscodeText, [to], settings.get(from), {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }))
        changed = true
      }
    }
    if (changed)
      files.push({ path: '.vscode/settings.json', content: vscodeText })
  }
  if (reviews !== undefined && !existsSync(join(root, '.x18n/reviews.yml'))) {
    files.push({
      path: '.x18n/reviews.yml',
      content: convertI18nAllyReviews(reviews.text, notes),
    })
    notes.push('Reviews were converted to `.x18n/reviews.yml`.')
  }
  return {
    files,
    notes,
    removable: [
      ...keys,
      ...found.customFramework
        ? [found.customFramework]
        : [],
      ...reviews
        ? [reviews.path]
        : [],
    ],
  }
}
