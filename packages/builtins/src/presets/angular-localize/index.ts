import type { MessageTree, Preset, ResourceSpec, Scanner, UsageCandidate } from '@x18n/core'
import { createLibraryPlugin, isMessageLeaf } from '@x18n/core'
import { angular } from '../../placeholders'
import { angularTemplates } from '../shared/angular-templates'
import { inlineHardStrings, templateHardStrings } from './hard-strings'
import { inlineTemplates, localizeMessages, templateMessages } from './messages'

type Translation = string | readonly string[]

interface AngularProject {
  readonly root?: string
  readonly i18n?: {
    readonly sourceLocale?: string | { readonly code?: string }
    readonly locales?: Readonly<Record<string, Translation | { readonly translation?: Translation }>>
  }
  readonly architect?: Readonly<Record<string, { readonly options?: { readonly format?: string, readonly outputPath?: string, readonly outFile?: string } }>>
}

/** `ng extract-i18n --format` values and the extension of the file each writes. */
const extractExtensions: Readonly<Record<string, string>> = {
  'xlf': 'xlf',
  'xlif': 'xlf',
  'xliff': 'xlf',
  'xlf2': 'xlf',
  'xliff2': 'xlf',
  'xmb': 'xmb',
  'json': 'json',
  'legacy-migrate': 'json',
  'arb': 'arb',
}

const readable = /\.(?:json|arb|xlf|xliff|xmb|xtb)$/

/** The files of an `i18n` block: each locale's translations and the extracted source, as resources. */
function readWorkspace(text: string): { sourceLocale: string | undefined, resources: ResourceSpec[] } {
  let workspace: { projects?: Readonly<Record<string, AngularProject>> }
  try {
    workspace = JSON.parse(text)
  }
  catch {
    return { sourceLocale: undefined, resources: [] }
  }
  const resources: ResourceSpec[] = []
  let sourceLocale: string | undefined
  for (const project of Object.values(workspace.projects ?? {})) {
    if (!project.i18n)
      continue
    const source = project.i18n.sourceLocale
    const code = (typeof source === 'string'
      ? source
      : source?.code) ?? 'en-US'
    sourceLocale ??= code
    for (const [locale, entry] of Object.entries(project.i18n.locales ?? {})) {
      const translation = typeof entry === 'string' || Array.isArray(entry)
        ? entry
        : (entry as { translation?: Translation }).translation
      for (const path of [translation ?? []].flat()) {
        if (readable.test(path))
          resources.push({ pattern: path, locale })
      }
    }
    const extract = project.architect?.['extract-i18n']?.options
    const extension = extractExtensions[extract?.format ?? 'xlf']
    if (extension) {
      const dir = (extract?.outputPath ?? project.root ?? '').replace(/\/+$/, '')
      const file = extract?.outFile ?? `messages.${extension}`
      resources.push({
        pattern: dir
          ? `${dir}/${file}`
          : file,
        locale: code,
      })
    }
  }
  return { sourceLocale, resources }
}

function candidate(id: string, range: { start: number, end: number }): UsageCandidate {
  return {
    raw: id,
    range,
    kind: 'marker',
    dynamic: false,
  }
}

/** Usages of `i18n` attributes and `$localize`, by custom id or by the id Angular computes from the message. */
const scanner: Scanner = {
  id: 'angular-localize',
  extensions: [
    ...angularTemplates,
    'mts',
    'mjs',
  ],
  scan(file, ctx) {
    if (file.extension === 'html') {
      return {
        usages: templateMessages(file.text).map(m => candidate(m.id, m.range)),
        hardStrings: templateHardStrings(file.text, ctx.config.extract.attributes),
      }
    }
    if (!file.text.includes('$localize') && !/\btemplate\s*:/.test(file.text))
      return { usages: [] }
    return {
      hardStrings: inlineHardStrings(file.text, ctx.config.extract.attributes),
      usages: [
        ...localizeMessages(file.text),
        ...inlineTemplates(file.text).flatMap(t => templateMessages(t.text).map(m => ({
          ...m,
          range: {
            start: t.at(m.range.start),
            end: t.at(m.range.end),
          },
        }))),
      ].map(m => candidate(m.id, m.range)),
    }
  },
}

/**
 * Angular's built-in i18n: `i18n` attributes in templates and `$localize` in code, with the translation files listed in
 * `angular.json` in any format `ng extract-i18n` writes: XLIFF 1.2 and 2.0, XMB with XTB, JSON and ARB.
 */
export function angularLocalize(): Preset {
  const paths = new Set<string>()
  return {
    name: 'angular-localize',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:angular-localize',
        keyStyle: 'flat',
        // `{ "locale": "fr", "translations": { "id": "..." } }` and ARB's `@@locale` and `@id` metadata hold messages around them.
        transformResource: {
          applies: ctx => paths.has(ctx.path) && /\.(?:json|arb)$/.test(ctx.path),
          read(tree, ctx) {
            if (ctx.path.endsWith('.arb'))
              return Object.fromEntries(Object.entries(tree).filter(([key]) => !key.startsWith('@')))
            const translations = tree.translations
            return translations && !isMessageLeaf(translations)
              ? translations as MessageTree
              : {}
          },
          toStored: (path, ctx) => ctx.path.endsWith('.arb')
            ? [
                path.join('.'),
              ]
            : [
                'translations',
                path.join('.'),
              ],
        },
        templates: [
          {
            template: '{attr} i18n="@@{key}"',
            kinds: ['html-element'],
          },
          {
            template: '<ng-container i18n="@@{key}">{source}</ng-container>',
            kinds: ['html-text'],
          },
          {
            template: 'i18n-{attr}="@@{key}" {source}',
            kinds: ['html-attribute'],
          },
          // An inline template in double quotes takes single quotes.
          {
            template: '{attr} i18n=\'@@{key}\'',
            kinds: ['dq-html-element'],
          },
          {
            template: '<ng-container i18n=\'@@{key}\'>{source}</ng-container>',
            kinds: ['dq-html-text'],
          },
          {
            template: 'i18n-{attr}=\'@@{key}\' {source}',
            kinds: ['dq-html-attribute'],
          },
          {
            template: '$localize`:@@{key}:{parts}`',
            kinds: ['js-string', 'js-template'],
          },
        ],
        placeholders: [angular],
        async extra(draft, ctx) {
          const text = await ctx.host.readFile('angular.json')
          if (!text)
            return
          const { sourceLocale, resources } = readWorkspace(text)
          if (sourceLocale && !ctx.user.sourceLocale)
            draft.sourceLocale = sourceLocale
          for (const spec of resources)
            paths.add(spec.pattern)
          draft.resources = [
            ...draft.resources,
            ...resources.filter(spec => !draft.resources.some(r => r.pattern === spec.pattern)),
          ]
        },
      }),
      {
        name: 'x18n:angular-localize-scanner',
        scanners: [scanner],
      },
    ],
  }
}

export default angularLocalize
