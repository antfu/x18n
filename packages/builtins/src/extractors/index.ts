// Rules and key generation adapted from i18n-ally (MIT), src/extraction/* and src/core/Extract.ts
import type { ExtractItem, ExtractOptions, ExtractTemplate, HardString, KeyString, Project, TextRange } from '@x18n/core'
import { createLineIndex, errors, pathMatcher } from '@x18n/core'

export type Score = 'must-include' | 'should-include' | 'none' | 'should-exclude' | 'must-exclude'

export interface ExtractionRule {
  readonly id: string
  readonly test: (text: string, kind: string, attribute: string | undefined) => Score
}

const textKinds = new Set([
  'jsx-text',
  'vue-template-text',
  'svelte-text',
  'astro-text',
  'html-text',
])

/** Built-in rules, applied in order. A `must-*` wins at once; otherwise the last `should-*` decides. */
export const rules: readonly ExtractionRule[] = [
  {
    id: 'letters',
    test: text => /\p{L}/u.test(text)
      ? 'none'
      : 'must-exclude',
  },
  {
    id: 'digits',
    test: text => /^[\d\s.,:%+-]+$/.test(text)
      ? 'must-exclude'
      : 'none',
  },
  {
    id: 'url',
    test: text => /^(?:[a-z][\w+.-]*:\/\/|mailto:|#|\/\/)/i.test(text.trim())
      ? 'must-exclude'
      : 'none',
  },
  {
    id: 'path',
    test: text => /^(?:\.{0,2}\/|~\/|@\/)[\w./@-]*$/.test(text.trim()) || /^[\w-]+\.[a-z]{2,4}$/i.test(text.trim())
      ? 'must-exclude'
      : 'none',
  },
  {
    id: 'translate-call',
    test: text => /\$?t\(['"`]/.test(text) || text.includes('{{')
      ? 'must-exclude'
      : 'none',
  },
  // `<svg viewBox="0 0 {0} {1}">{2}</svg>`: markup whose only letters sit inside tags.
  {
    id: 'markup',
    test: text => /^<.*>$/s.test(text.trim()) && !/\p{L}/u.test(text.replace(/<[^>]*>|\{\d+\}/g, ''))
      ? 'must-exclude'
      : 'none',
  },
  {
    id: 'svg-path',
    test: text => /^\s*M\s*-?[\d.]/i.test(text) && /^[MLHVCSQTAZ\d\s.,-]+$/i.test(text)
      ? 'must-exclude'
      : 'none',
  },
  // `!color-base underline underline-offset-6`: utility class lists, where most tokens carry a `-`, `:`, `!`, `/`, `[` or digit.
  {
    id: 'class-list',
    test: (text) => {
      const tokens = text.trim().split(/\s+/)
      return tokens.every(t => /^!?[a-z][\w:/[\].#%!-]*$/.test(t)) && tokens.filter(t => /[-:!/[\d]/.test(t)).length * 2 > tokens.length
        ? 'must-exclude'
        : 'none'
    },
  },
  // `text="xs secondary"`, `sm:text="lg"`: attributify utilities on an attribute that is also a common text prop.
  {
    id: 'attributify',
    test: (text, kind, attribute) => kind.endsWith('attribute') && (attribute === 'text' || attribute?.includes(':') === true)
      && text.trim().split(/\s+/).every(t => /^!?-?[a-z\d$[(][\w:/[\]().,#%!$+~-]*$/.test(t))
      ? 'must-exclude'
      : 'none',
  },
  // `repeating-linear-gradient(to right, var(--c-primary) 0%, ...)`, `calc(100% - 2rem)`: CSS values.
  {
    id: 'css-value',
    test: text => /^-?[a-z][\w-]*\(.*\)$/s.test(text.trim()) || /\bvar\(--/.test(text)
      ? 'must-exclude'
      : 'none',
  },
  {
    id: 'non-ascii',
    test: text => /\P{ASCII}/u.test(text) && /\p{L}/u.test(text)
      ? 'must-include'
      : 'none',
  },
  {
    id: 'sentence',
    test: text => /\p{L}\s+\p{L}/u.test(text)
      ? 'should-include'
      : 'none',
  },
  {
    id: 'text-node',
    test: (text, kind) => textKinds.has(kind) || kind.endsWith('attribute')
      ? 'should-include'
      : 'none',
  },
  {
    id: 'single-word',
    test: (text, kind) => !textKinds.has(kind) && !kind.endsWith('attribute') && !/\s/.test(text.trim())
      ? 'should-exclude'
      : 'none',
  },
  // `tag="p"`, `type="submit"`: attribute values that are one lowercase token are code, not text.
  {
    id: 'attribute-token',
    test: (text, kind) => kind.endsWith('attribute') && /^[a-z][\w-]*$/.test(text.trim())
      ? 'must-exclude'
      : 'none',
  },
  {
    id: 'identifier',
    test: text => /^[a-z]+(?:[A-Z][a-z\d]*)+$/.test(text) || /^[A-Z\d]+(?:_[A-Z\d]+)+$/.test(text) || /^[a-z\d]+(?:[-_.:][a-z\d]+)+$/.test(text)
      ? 'should-exclude'
      : 'none',
  },
]

/** Files whose strings users never see, by the naming conventions of common languages and test runners. */
const nonUiFiles: readonly RegExp[] = [
  // test/, tests/, spec/, src/test/java/, e2e/, cypress/, fixtures/, mocks/, testdata/, __tests__/, __snapshots__/
  /(?:^|\/)(?:tests?|specs?|e2e|cypress|fixtures?|mocks?|testdata|__(?:tests|mocks|snapshots|fixtures)__)\//i,
  // a.test.ts, a_test.go, a_test.py, a_spec.rb, a-spec.js, a.cy.ts, a.e2e.ts, a.stories.tsx, vite.config.ts, nginx.conf.js
  /[._-](?:tests?|specs?|e2e|cy|stories|story|config|conf)\.\w+$/i,
  // test_a.py, test_a.c, tests.py, conftest.py, spec.rb, config.ts
  /(?:^|\/)(?:test_[^/]+|(?:tests?|specs?|conftest|config)\.\w+)$/i,
  // FooTest.java, FooTests.cs, FooSpec.scala, FooIT.java, FooTest.php, FooTests.swift
  /[a-z\d](?:Tests?|Spec|IT)\.(?:java|kt|kts|scala|groovy|cs|fs|vb|php|swift|m|mm)$/,
  /\.d\.[cm]?ts$/,
]

function isExtractableFile(path: string): boolean {
  return !nonUiFiles.some(pattern => pattern.test(path))
}

/** Folds rule scores the i18n-ally way (`shouldExtract`). */
export function shouldExtract(text: string, kind: string, list: readonly ExtractionRule[] = rules, attribute?: string): boolean {
  let result: Score = 'none'
  for (const rule of list) {
    const score = rule.test(text, kind, attribute)
    if (score === 'must-include')
      return true
    if (score === 'must-exclude')
      return false
    if (score !== 'none')
      result = score
  }
  return result === 'should-include'
}

/** Words of a text for slugs: letters and digits only. */
function words(text: string): string[] {
  return text.normalize('NFKD').replace(/[\u0300-\u036F]/g, '').split(/[^\p{L}\d]+/u).filter(Boolean)
}

export type KeyCase = 'camel' | 'snake' | 'kebab' | 'dot'

/** "Forgot password?" becomes `forgotPassword` (camel), `forgot_password`, `forgot-password` or `forgot.password`. */
export function slugify(text: string, keyCase: KeyCase = 'camel', maxLength = 40): string {
  const parts: string[] = []
  let length = 0
  for (const word of words(text).map(w => w.toLowerCase())) {
    if (length + word.length > maxLength && parts.length > 0)
      break
    parts.push(word)
    length += word.length + 1
  }
  if (parts.length === 0)
    return 'text'
  switch (keyCase) {
    case 'snake': return parts.join('_')
    case 'kebab': return parts.join('-')
    case 'dot': return parts.join('.')
    default: return parts.map((word, i) => i === 0
      ? word
      : word[0]!.toUpperCase() + word.slice(1)).join('')
  }
}

/** Fallback templates per kind, used after config and preset templates. */
export const defaultTemplates: readonly ExtractTemplate[] = [
  {
    template: '{t(\'{key}\'{args})}',
    kinds: ['jsx-text', 'astro-text'],
  },
  {
    template: '{attr}={t(\'{key}\'{args})}',
    kinds: ['jsx-attribute', 'astro-attribute'],
  },
  {
    template: '{{ $t(\'{key}\'{args}) }}',
    kinds: ['vue-template-text', 'html-text'],
  },
  {
    template: ':{attr}="$t(\'{key}\'{args})"',
    kinds: ['vue-attribute', 'html-attribute'],
  },
  {
    template: '{$t(\'{key}\'{args})}',
    kinds: ['svelte-text'],
  },
  {
    template: '{attr}={$t(\'{key}\'{args})}',
    kinds: ['svelte-attribute'],
  },
  { template: 't(\'{key}\'{args})' },
]

export interface ExtractCandidate {
  readonly path: string
  /** 1-based line, for display. */
  readonly line: number
  readonly kind: string
  readonly text: string
  /** The text in the file at `range`, used to detect stale plans. */
  readonly original: string
  readonly range: TextRange
  readonly attribute: string | undefined
  readonly key: KeyString
  /** True when an existing key with the same source value is reused. */
  readonly reused: boolean
  /** The message to store: template arguments become placeholders. */
  readonly value: string
  readonly replacement: string
  readonly imports: readonly string[]
  /** Other templates that also apply, for surfaces that let users choose. */
  readonly alternatives: readonly string[]
}

export interface FindOptions {
  /** Only these files (globs). */
  readonly files?: readonly string[] | undefined
}

function prefixFor(template: string | undefined, path: string): string {
  if (!template)
    return ''
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
  const dir = path.includes('/')
    ? path.slice(0, path.lastIndexOf('/')).split('/').at(-1)!
    : ''
  return template
    .replace('{fileName}', slugify(base))
    .replace('{dirName}', slugify(dir))
    .replace('{component}', base.replace(/(?:^|[-_])(\w)/g, (_, c: string) => c.toUpperCase()))
}

function randomKey(): string {
  return Math.random().toString(36).slice(2, 10)
}

interface Planned {
  readonly key: KeyString
  readonly reused: boolean
}

class KeyAllocator {
  readonly byValue = new Map<string, KeyString>()
  readonly taken = new Map<KeyString, string>()

  constructor(readonly project: Project) {
    const options = project.config.extract
    for (const key of project.keys()) {
      const value = project.message(key, project.sourceLocale)?.value
      if (typeof value === 'string') {
        this.taken.set(key, value)
        if (options.reuseExisting !== false && !this.byValue.has(value))
          this.byValue.set(value, key)
      }
    }
  }

  allocate(value: string, path: string, slugText: string): Planned {
    const options = this.project.config.extract
    const reused = this.byValue.get(value)
    if (reused) {
      return {
        key: reused,
        reused: this.taken.has(reused),
      }
    }
    const strategy = options.keygen ?? 'slug'
    const prefix = prefixFor(options.keyPrefix, path)
    let base: string
    if (strategy === 'source')
      base = value
    else if (strategy === 'random')
      base = randomKey()
    else if (strategy === 'empty')
      base = ''
    else
      base = slugify(slugText, options.keyCase ?? 'camel', options.keyMaxLength ?? 40)
    const raw = prefix
      ? `${prefix}.${base}`
      : base
    let key = this.project.parseKey(raw)
    for (let i = 2; this.taken.has(key) && this.taken.get(key) !== value; i++)
      key = this.project.parseKey(`${raw}${i}`)
    this.taken.set(key, value)
    this.byValue.set(value, key)
    return { key, reused: false }
  }
}

function ignoredByConfig(options: ExtractOptions, hard: HardString & { path: string }): boolean {
  const matches = (rule: string): boolean => {
    const regex = /^\/(.+)\/([a-z]*)$/.exec(rule)
    return regex
      ? new RegExp(regex[1]!, regex[2]).test(hard.text)
      : rule === hard.text
  }
  if (options.ignore?.some(matches))
    return true
  for (const [glob, list] of Object.entries(options.ignoreByFile ?? {})) {
    if (pathMatcher([glob])(hard.path) && list.some(matches))
      return true
  }
  return hard.attribute !== undefined && options.ignoreAttributes?.includes(hard.attribute) === true
}

const ignoreLine = /x18n-ignore(?![-\w])/

/**
 * Offsets silenced by control comments: `x18n-ignore-file` anywhere, inside `x18n-ignore-start` ... `x18n-ignore-end`
 * (to the end of the file when unclosed), or on the line of, or the line after, `x18n-ignore`.
 */
function commentIgnores(text: string): (offset: number) => boolean {
  if (text.includes('x18n-ignore-file'))
    return () => true
  const regions = [
    ...text.matchAll(/x18n-ignore-start[\s\S]*?(?:x18n-ignore-end|$)/g),
  ].map(m => [m.index, m.index + m[0].length] as const)
  const index = createLineIndex(text)
  return (offset) => {
    if (regions.some(([start, end]) => offset >= start && offset < end))
      return true
    const line = index.position(offset).line
    return ignoreLine.test(index.line(line)) || (line > 0 && ignoreLine.test(index.line(line - 1)))
  }
}

/** Hard strings worth extracting: they pass the rules and no non-UI file, config ignore or control comment skips them. */
export function* extractableHardStrings(
  options: ExtractOptions,
  hardStrings: Iterable<HardString & { readonly path: string }>,
  textOf: (path: string) => string | undefined,
): Generator<HardString & { readonly path: string }> {
  const ignores = new Map<string, (offset: number) => boolean>()
  for (const hard of hardStrings) {
    if (!isExtractableFile(hard.path) || !shouldExtract(hard.text, hard.kind, rules, hard.attribute) || ignoredByConfig(options, hard))
      continue
    let ignored = ignores.get(hard.path)
    if (!ignored) {
      const text = textOf(hard.path)
      ignored = text === undefined
        ? () => true
        : commentIgnores(text)
      ignores.set(hard.path, ignored)
    }
    if (!ignored(hard.range.start))
      yield hard
  }
}

/** Placeholder shape of the project's first placeholder syntax, `{name}` by default. */
function placeholderShape(project: Project): (name: string) => string {
  const example = project.placeholderSyntaxes.find(s => s.example?.includes('name'))?.example ?? '{name}'
  return name => example.replace('name', name)
}

function templatesFor(project: Project, kind: string, path: string): string[] {
  return [
    ...project.extractTemplates,
    ...defaultTemplates,
  ]
    .filter(t => (!t.kinds || t.kinds.includes(kind)) && (!t.files || pathMatcher(t.files)(path)))
    .map(t => t.template)
}

function rawKeyFor(project: Project, key: KeyString): string {
  const ns = project.config.namespace.default
  return project.namespaced && ns && key.startsWith(`${ns}:`)
    ? key.slice(ns.length + 1)
    : key
}

/**
 * Escapes a key for the quotes around `{key}` in a template, since `keygen: 'source'` keys hold any text:
 * backslashes inside a JS string, entities inside a double-quoted attribute (`:title="$t('{key}')"`).
 */
function quoteKey(before: string, key: string): string {
  const quote = before.at(-1)
  const inAttribute = /="[^"]*$/.test(before)
  let out = key
  if (quote === '\'' || quote === '`' || (quote === '"' && !inAttribute)) {
    out = out.replace(quote === '`'
      ? /[\\`]|\$\{/g
      : new RegExp(`[\\\\${quote}]`, 'g'), c => `\\${c}`)
  }
  return inAttribute
    ? out.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    : out
}

function fillTemplate(template: string, values: { readonly key: string, readonly attr: string, readonly args: string }): string {
  return template.replace(/\{(key|attr|args)\}/g, (_, name: 'key' | 'attr' | 'args', at: number) => {
    if (name === 'key')
      return quoteKey(template.slice(0, at), values.key)
    // `{args}` as the first argument (`m.{key}({args})`) drops its leading `, `.
    return name === 'args' && template[at - 1] === '('
      ? values.args.replace(/^, /, '')
      : values[name]
  })
}

/** Hard strings worth extracting, with proposed keys, values and replacements. */
export function findCandidates(project: Project, options: FindOptions = {}): ExtractCandidate[] {
  const inFiles = options.files?.length
    ? pathMatcher(options.files)
    : undefined
  const keys = new KeyAllocator(project)
  const shape = placeholderShape(project)
  const out: ExtractCandidate[] = []
  const inScope = [
    ...project.hardStrings(),
  ].filter(hard => !inFiles || inFiles(hard.path))
  for (const hard of extractableHardStrings(project.config.extract, inScope, path => project.text(path))) {
    const text = project.text(hard.path)
    if (text === undefined)
      continue
    const value = hard.kind === 'js-template'
      ? hard.text.replace(/\{(\d+)\}/g, (_, i: string) => shape(hard.args?.[Number(i)]?.name ?? `arg${i}`))
      : hard.text
    const { key, reused } = keys.allocate(value, hard.path, hard.text.replace(/\{\d+\}/g, ' '))
    const templates = templatesFor(project, hard.kind, hard.path)
    const chosen = templates[0]!
    const args = hard.args?.length
      ? `, { ${hard.args.map(a => a.name === a.expression
        ? a.name
        : `${a.name}: ${a.expression}`).join(', ')} }`
      : ''
    const template = project.extractTemplates.find(t => t.template === chosen)
    out.push({
      path: hard.path,
      line: createLineIndex(text).position(hard.range.start).line + 1,
      kind: hard.kind,
      text: hard.text,
      original: text.slice(hard.range.start, hard.range.end),
      range: hard.range,
      attribute: hard.attribute,
      key,
      reused,
      value,
      replacement: fillTemplate(chosen, {
        key: rawKeyFor(project, key),
        attr: hard.attribute ?? '',
        args,
      }),
      imports: template?.imports ?? [],
      alternatives: templates.slice(1),
    })
  }
  return out
}

export interface ExtractPlanFile {
  readonly x18n: 1
  readonly project: string
  readonly items: readonly ExtractCandidate[]
}

export function toPlanFile(project: Project, candidates: readonly ExtractCandidate[]): ExtractPlanFile {
  return { x18n: 1, project: project.name, items: candidates }
}

/** Turns plan items (maybe edited by a human or agent) into edit items, after checking the files did not change. */
export function extractItems(project: Project, items: readonly Pick<ExtractCandidate, 'path' | 'range' | 'original' | 'key' | 'value' | 'replacement' | 'imports'>[]): ExtractItem[] {
  return items.map((item) => {
    const text = project.text(item.path)
    if (text === undefined || text.slice(item.range.start, item.range.end) !== item.original)
      throw errors.X18N4004({ path: item.path })
    return {
      path: item.path,
      range: item.range,
      key: project.parseKey(item.key),
      value: item.value,
      replacement: item.replacement,
      imports: item.imports,
    }
  })
}
