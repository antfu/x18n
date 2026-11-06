// Adapted from i18n-ally (MIT), src/utils/PathMatcher.ts and src/core/loaders/LocaleLoader.ts
import type { FinderContext, LocaleFinder, NamespaceFromPath, Plugin, ResourceCandidate, ResourceSpec } from '@x18n/core'

const localeLike = /^[a-z]{2,3}(?:[-_][a-z\d]{2,8})*$/i

function isLocaleCode(text: string): boolean {
  if (!localeLike.test(text))
    return false
  try {
    return Intl.getCanonicalLocales(text.replace(/_/g, '-')).length === 1
  }
  catch {
    return false
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+^$()|[\]\\]/g, '\\$&')
}

export interface CompiledPattern {
  /** Glob for the host. */
  readonly glob: string
  readonly match: (path: string) => { locale: string | undefined, namespace: string | undefined, ext: string } | undefined
}

/**
 * Compiles a resource pattern. Tokens: `{locale}`, `{locale?}`, `{namespace}`,
 * `{namespaces}` (several segments, joined with `.`), `{ext}`; plus `*` and `**`.
 */
export function compilePattern(pattern: string, extensions: readonly string[]): CompiledPattern {
  const normalized = pattern.replace(/^\.\//, '')
  const ext = `(?<ext>${extensions.map(escapeRegExp).join('|')})`
  let source = ''
  let glob = ''
  const tokens = /\{[^}]*\}|\*\*\/|\*\*|\*|\?/g
  let last = 0
  for (const match of normalized.matchAll(tokens)) {
    const literal = normalized.slice(last, match.index)
    source += escapeRegExp(literal)
    glob += literal
    last = match.index + match[0].length
    switch (match[0]) {
      case '{locale}':
        source += '(?<locale>[\\w-]+)'
        glob += '*'
        break
      case '{locale?}':
        source += '(?<locale>[\\w-]+)?'
        glob += '*'
        break
      case '{namespace}':
        source += '(?<namespace>[^/]+)'
        glob += '*'
        break
      case '{namespaces}':
        source += '(?<namespace>.+)'
        glob += '**'
        break
      case '{ext}':
        source += ext
        glob += extensions.length === 1
          ? extensions[0]
          : `{${extensions.join(',')}}`
        break
      case '**/':
        source += '(?:.*/)?'
        glob += '**/'
        break
      case '**':
        source += '.*'
        glob += '**'
        break
      case '*':
        source += '[^/]*'
        glob += '*'
        break
      case '?':
        source += '[^/]'
        glob += '?'
        break
      default: {
        const options = match[0].slice(1, -1).split(',')
        source += `(?:${options.map(escapeRegExp).join('|')})`
        glob += match[0]
      }
    }
  }
  source += escapeRegExp(normalized.slice(last))
  glob += normalized.slice(last)
  const regex = new RegExp(`^${source}$`)
  return {
    glob,
    match(path) {
      const found = regex.exec(path)
      if (!found)
        return undefined
      const groups = found.groups ?? {}
      const extension = groups.ext ?? path.slice(path.lastIndexOf('.') + 1)
      return {
        locale: groups.locale,
        namespace: groups.namespace,
        ext: extension,
      }
    },
  }
}

const localeDirNames = [
  'locales',
  'locale',
  'i18n',
  'lang',
  'langs',
  'language',
  'languages',
  'translations',
  'messages',
  '_locales',
  'l10n',
]

/** Guesses resource patterns from directories named like `locales`, as i18n-ally did without `localesPaths`. */
export async function guessResources(ctx: FinderContext): Promise<ResourceSpec[]> {
  const exts = ctx.extensions.length === 1
    ? ctx.extensions[0]!
    : `{${ctx.extensions.join(',')}}`
  const files = await ctx.host.glob([`**/{${localeDirNames.join(',')}}/**/*.${exts}`], {
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/build/**',
    ],
    gitignore: true,
  })
  const dirs = new Map<string, string[]>()
  for (const file of files) {
    const segments = file.split('/')
    const index = segments.findLastIndex(segment => localeDirNames.includes(segment))
    const dir = segments.slice(0, index + 1).join('/')
    const list = dirs.get(dir) ?? []
    dirs.set(dir, list)
    list.push(segments.slice(index + 1).join('/'))
  }
  const specs: ResourceSpec[] = []
  for (const [dir, rest] of dirs) {
    const stem = (file: string): string => file.slice(0, file.lastIndexOf('.'))
    const fileLayout = rest.filter(file => !file.includes('/') && isLocaleCode(stem(file))).length
    const dirLayout = rest.filter(file => file.includes('/') && isLocaleCode(file.split('/')[0]!)).length
    if (fileLayout === 0 && dirLayout === 0)
      continue
    specs.push({
      pattern: fileLayout >= dirLayout
        ? `${dir}/{locale}.{ext}`
        : `${dir}/{locale}/{namespaces}.{ext}`,
    })
  }
  return specs
}

/** A namespace from a path in the style of `namespace.fromPath`. Transloco camelCases scope folders, as its `toCamelCase`. */
export function namespaceFromPath(path: string, style: NamespaceFromPath): string {
  if (style === 'slash')
    return path
  if (style === 'camel')
    return path.replace(/[-_/\s]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/^./, c => c.toLowerCase())
  return path.replace(/\//g, '.')
}

async function findBySpecs(ctx: FinderContext, specs: readonly ResourceSpec[], strictLocales: boolean): Promise<ResourceCandidate[]> {
  const out: ResourceCandidate[] = []
  for (const spec of specs) {
    const compiled = compilePattern(spec.pattern, ctx.extensions)
    // A pattern without a locale token holds the source locale (`package.nls.json`, `i18n.properties`).
    const fixed = spec.locale ?? (spec.pattern.includes('{locale')
      ? undefined
      : ctx.config.sourceLocale)
    const paths = await ctx.host.glob([compiled.glob], {
      ignore: ['**/node_modules/**'],
      gitignore: false,
    })
    for (const path of paths) {
      const matched = compiled.match(path)
      if (!matched)
        continue
      const locale = fixed ?? matched.locale ?? (spec.pattern.includes('{locale?}')
        ? ctx.config.sourceLocale
        : undefined)
      // A `{locale}` the user did not write must look like a locale code, so `locales/index.ts` is not a resource.
      if (!locale || (strictLocales && !isLocaleCode(locale)))
        continue
      const namespace = spec.namespace ?? (matched.namespace === undefined
        ? undefined
        : namespaceFromPath(matched.namespace, ctx.config.namespace.fromPath))
      out.push({
        path,
        locale,
        namespace,
        format: spec.format,
        readonly: spec.execute === true,
        execute: spec.execute === true,
        ...spec.keySeparator === undefined
          ? {}
          : { keySeparator: spec.keySeparator },
      })
    }
  }
  return out
}

export const patternFinder: LocaleFinder = {
  id: 'pattern',
  resolveNew(target, ctx) {
    const style = ctx.config.namespace.fromPath
    for (const spec of ctx.config.resources) {
      const wantsNamespace = /\{namespaces?\}/.test(spec.pattern)
      // A camelCased namespace has lost its folder name; the planner mirrors a sibling's path instead.
      if (wantsNamespace !== (target.namespace !== undefined) || (wantsNamespace && style === 'camel') || spec.execute || !spec.pattern.includes('{locale'))
        continue
      const path = spec.pattern
        .replace(/^\.\//, '')
        .replace(/\{locale\??\}/g, target.locale)
        .replace('{namespaces}', style === 'slash'
          ? target.namespace ?? ''
          : (target.namespace ?? '').replace(/\./g, '/'))
        .replace('{namespace}', target.namespace ?? '')
        .replace('{ext}', spec.format === 'yaml'
          ? 'yml'
          : spec.format ?? 'json')
      if (!/[*?{}[\]]/.test(path))
        return path
    }
    return undefined
  },
  async find(ctx) {
    const configured = ctx.config.resources
    const fromUser = ctx.config.origins.resources === 'user' || ctx.config.origins.resources === 'parent'
    // Patterns the user did not write (preset defaults, i18n-ally settings) only match locale-like names.
    const found = configured.length > 0
      ? await findBySpecs(ctx, configured, !fromUser)
      : []
    // Preset defaults that match nothing fall back to the guess, as without a config.
    if (found.length > 0 || fromUser)
      return found
    return findBySpecs(ctx, await guessResources(ctx), true)
  },
}

/** The `pattern` locale finder: files that match `resources[].pattern`, or guessed locale directories. */
export function pattern(): Plugin {
  return {
    name: 'x18n:finder-pattern',
    localeFinders: [patternFinder],
  }
}
