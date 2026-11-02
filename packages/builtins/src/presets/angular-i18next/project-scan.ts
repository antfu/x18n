import type { ConfigContext } from '@x18n/core'
import type { PipeScope, ProjectFacts } from './scanner'
import { boundNames, objectAt } from './scanner'

interface Component {
  readonly name: string
  readonly file: string
  /** Where the component is in its file: its decorator up to the next component. */
  readonly span: { readonly start: number, readonly end: number }
  readonly templateFile: string | undefined
  readonly selectors: readonly string[]
  readonly template: string
  readonly own: PipeScope
}

export interface ProjectScan {
  /** Namespaces whose keys `<i18next-validation-message>` builds at runtime. */
  readonly validation: readonly string[]
  /** The later namespaces of `useValue: ['x', 'y']`. */
  readonly fallback: readonly string[]
  /** Names a class gives the i18next service, for `getFixedT`. */
  readonly services: readonly string[]
}

/** The values of a provider: `useValue: 'x'` or `useValue: ['x', 'y']`, which the library tries in order. */
function providerValues(code: string, token: string): string[] {
  const value = new RegExp(`provide\\s*:\\s*${token}\\b[^}]*?useValue\\s*:\\s*(\\[[^\\]]*\\]|['"\`][^'"\`]+['"\`])`).exec(code)?.[1]
  return [
    ...value?.matchAll(/['"`]([^'"`]+)['"`]/g) ?? [],
  ].map(match => match[1]!)
}

function scopeOf(code: string, fallback: Set<string>): PipeScope {
  const [namespace, ...others] = providerValues(code, 'I18NEXT_NAMESPACE')
  const [keyPrefix, ...otherPrefixes] = providerValues(code, 'I18NEXT_SCOPE')
  for (const other of others)
    fallback.add(other)
  return { namespace, keyPrefix, otherPrefixes }
}

function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1)
}

/** A path relative to the file that imports it, without its extension when it has none. */
function resolvePath(from: string, relative: string): string {
  return new URL(relative, `file:///${dirname(from)}`).pathname.slice(1)
}

/** Selectors of a component: `app-a`, `[appB]`, `app-c, [appD]`. */
function selectorsOf(value: string | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

function usesSelector(template: string, selector: string): boolean {
  const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1]
  const pattern = attribute
    ? `<[^>]*\\s\\[?${attribute}\\]?[\\s=>/]`
    : `<${selector}[\\s>/]`
  return new RegExp(pattern).test(template)
}

async function readComponents(code: string, file: string, read: (path: string) => Promise<string>, fallback: Set<string>): Promise<Component[]> {
  const out: Component[] = []
  const matches = [
    ...code.matchAll(/@Component\s*\(\s*/g),
  ]
  for (const [index, match] of matches.entries()) {
    const meta = objectAt(code, match.index + match[0].length)
    if (!meta)
      continue
    const after = code.slice(match.index + match[0].length + meta.length)
    const name = /\bclass\s+(\w+)/.exec(after)?.[1] ?? ''
    const url = /\btemplateUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(meta)?.[1]
    const templateFile = url
      ? resolvePath(file, url)
      : undefined
    const inline = /\btemplate\s*:\s*(['"`])([\s\S]*?)\1\s*[,}\n]/.exec(meta)?.[2] ?? ''
    out.push({
      name,
      file,
      span: { start: match.index, end: matches[index + 1]?.index ?? code.length },
      templateFile,
      selectors: selectorsOf(/\bselector\s*:\s*['"`]([^'"`]+)['"`]/.exec(meta)?.[1]),
      template: templateFile
        ? await read(templateFile)
        : inline,
      own: scopeOf(meta, fallback),
    })
  }
  return out
}

/** The route or other object a provider sits in, when it describes a route: its text is what the provider reaches. */
function reachOfProvider(code: string): string {
  const at = /provide\s*:\s*I18NEXT_(?:NAMESPACE|SCOPE)\b/.exec(code)?.index
  if (at === undefined)
    return code
  let depth = 0
  for (let i = at; i >= 0; i--) {
    const char = code[i]
    if (char === '}' || char === ']')
      depth++
    else if (char === '{' || char === '[')
      depth--
    if (char === '{' && depth < -1) {
      const object = objectAt(code, i)
      if (object && /\bpath\s*:/.test(object))
        return object
    }
  }
  return code
}

/** The components a text names, by class or through `import('./path')`, following routes files. */
function componentsReached(text: string, file: string, components: readonly Component[], read: (path: string) => string | undefined, seen = new Set<string>()): Component[] {
  const out = components.filter(c => c.name && new RegExp(`\\b${c.name}\\b`).test(text))
  for (const match of text.matchAll(/\bimport\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
    const target = `${resolvePath(file, match[1]!)}.ts`
    if (seen.has(target))
      continue
    seen.add(target)
    const inFile = components.filter(c => c.file === target)
    out.push(...inFile)
    const code = read(target)
    if (!inFile.length && code)
      out.push(...componentsReached(code, target, components, read, seen))
  }
  return out
}

function merged(child: PipeScope | undefined, parent: PipeScope): PipeScope {
  return {
    namespace: child?.namespace ?? parent.namespace,
    keyPrefix: child?.keyPrefix ?? parent.keyPrefix,
    otherPrefixes: child?.keyPrefix ? child.otherPrefixes : parent.otherPrefixes,
  }
}

const hasScope = (scope: PipeScope): boolean => !!scope.namespace || !!scope.keyPrefix

/** The object around an offset. */
function enclosingObject(code: string, at: number): string | undefined {
  let depth = 0
  for (let i = at; i >= 0; i--) {
    if (code[i] === '}')
      depth++
    else if (code[i] === '{' && --depth < 0)
      return objectAt(code, i)
  }
  return undefined
}

/** What a component's `<router-outlet>` shows: the children of its route, or every route for the component bootstrapped. */
function outletChildren(component: Component, components: readonly Component[], texts: ReadonlyMap<string, string>): Component[] {
  if (!component.name || !component.template.includes('<router-outlet'))
    return []
  const read = (path: string): string | undefined => texts.get(path)
  const out: Component[] = []
  const root = new RegExp(`\\b(?:bootstrapApplication\\(\\s*|bootstrap\\s*:\\s*\\[\\s*)${component.name}\\b`)
  const isRoot = [
    ...texts.values(),
  ].some(code => root.test(code))
  const routed = new RegExp(`\\bcomponent\\s*:\\s*${component.name}\\b|\\.${component.name}\\b`, 'g')
  for (const [path, code] of texts) {
    if (!path.endsWith('.ts') || !/\bpath\s*:/.test(code))
      continue
    if (isRoot) {
      out.push(...componentsReached(code, path, components, read))
      continue
    }
    for (const match of code.matchAll(routed)) {
      const route = enclosingObject(code, match.index)
      const children = route && /\bchildren\s*:\s*\[|\bloadChildren\s*:/.exec(route)
      if (children)
        out.push(...componentsReached(route.slice(children.index), path, components, read))
    }
  }
  return out.filter(child => child !== component)
}

/** Gives each component the scope it inherits through the templates that use it. The nearest provider wins. */
function spread(components: readonly Component[], starts: ReadonlyMap<Component, PipeScope>, facts: ProjectFacts, texts: ReadonlyMap<string, string>): void {
  const scopes = new Map<Component, PipeScope>()
  let level = [
    ...starts.entries(),
  ].map(([component, scope]) => [
    component,
    merged(component.own, scope),
  ] as const)
  for (const component of components) {
    if (hasScope(component.own) && !starts.has(component))
      level.push([component, component.own])
  }
  while (level.length) {
    const next: (readonly [Component, PipeScope])[] = []
    for (const [component, scope] of level) {
      if (scopes.has(component))
        continue
      scopes.set(component, scope)
      const routed = outletChildren(component, components, texts)
      for (const child of components) {
        if (!scopes.has(child) && (routed.includes(child) || child.selectors.some(s => usesSelector(component.template, s)))) {
          next.push([
            child,
            merged(child.own, scope),
          ])
        }
      }
    }
    level = next
  }
  for (const [component, scope] of scopes) {
    facts.spans.set(component.file, [
      ...facts.spans.get(component.file) ?? [],
      { ...component.span, scope },
    ])
    if (component.templateFile)
      facts.scopes.set(component.templateFile, scope)
  }
}

function readFacts(path: string, code: string, facts: ProjectFacts, validation: Set<string>, services: Set<string>): void {
  if (/useClass\s*:\s*I18NextTitle\b/.test(code))
    facts.titles = true
  if (code.includes('i18next-validation-message') || code.includes('angular-i18next/forms')) {
    validation.add('validation:**')
    for (const match of code.matchAll(/\bi18nextNamespace\s*=\s*["']([^"']+)["']/g))
      validation.add(`${match[1]}.validation:**`)
  }
  if (path.endsWith('.ts') && code.includes('getFixedT')) {
    for (const name of boundNames(code, 'I18NextService|ITranslationService', 'I18NEXT_SERVICE'))
      services.add(name)
  }
}

/** The components each module or routes file reaches. A list of providers alone reaches its folder. */
function providerStarts(texts: ReadonlyMap<string, string>, components: readonly Component[], facts: ProjectFacts, fallback: Set<string>): Map<Component, PipeScope> {
  const starts = new Map<Component, PipeScope>()
  for (const [path, code] of texts) {
    if (!path.endsWith('.ts') || code.includes('@Component') || !/provide\s*:\s*I18NEXT_(?:NAMESPACE|SCOPE)\b/.test(code))
      continue
    const scope = scopeOf(code, fallback)
    const reached = componentsReached(reachOfProvider(code), path, components, p => texts.get(p))
    if (!reached.length)
      facts.scopes.set(dirname(path), scope)
    for (const component of reached) {
      if (!starts.has(component))
        starts.set(component, scope)
    }
  }
  return starts
}

/** What only the whole project can say: which files providers reach, the title service, and validation messages. */
export async function scanProject(host: ConfigContext['host'], facts: ProjectFacts): Promise<ProjectScan> {
  const paths = await host.glob(['**/*.{ts,html}'], {
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.spec.ts',
      '**/*.d.ts',
    ],
    gitignore: true,
  })
  const texts = new Map<string, string>()
  for (const path of paths)
    texts.set(path, await host.readFile(path) ?? '')
  const read = async (path: string): Promise<string> => texts.get(path) ?? ''

  const validation = new Set<string>()
  const fallback = new Set<string>()
  const services = new Set<string>()
  const components: Component[] = []
  facts.scopes.clear()
  facts.spans.clear()
  facts.titles = false
  for (const [path, code] of texts) {
    readFacts(path, code, facts, validation, services)
    if (path.endsWith('.ts') && code.includes('@Component'))
      components.push(...await readComponents(code, path, read, fallback))
  }
  spread(components, providerStarts(texts, components, facts, fallback), facts, texts)
  return {
    validation: [...validation],
    fallback: [...fallback],
    services: [...services],
  }
}
