// Config fields from i18next-cli (MIT), src/types.ts and src/config.ts
import type { CallSpec, ConfigContext, Plugin } from '@x18n/core'
import type { Node, Program } from 'oxc-parser'
import { i18nextArgs } from './plugin'

/** The files i18next-cli looks for at the project root, in its order. */
const configFiles = [
  'i18next.config.ts',
  'i18next.config.mts',
  'i18next.config.js',
  'i18next.config.mjs',
  'i18next.config.cjs',
]

type Value = string | number | boolean | readonly Value[] | { readonly [key: string]: Value }
interface Fields { readonly [key: string]: Value }

function unwrap(node: Node): Node {
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' || node.type === 'TSNonNullExpression' || node.type === 'ParenthesizedExpression')
    return unwrap(node.expression)
  const [argument] = node.type === 'CallExpression'
    ? node.arguments
    : []
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'defineConfig' && argument && argument.type !== 'SpreadElement')
    return unwrap(argument)
  return node
}

/** The value of a literal: strings, numbers, booleans, and arrays and objects of them. Anything else is undefined, and left out of its array or object. */
function literal(node: Node): Value | undefined {
  const target = unwrap(node)
  if (target.type === 'Literal' && (typeof target.value === 'string' || typeof target.value === 'number' || typeof target.value === 'boolean'))
    return target.value
  if (target.type === 'TemplateLiteral' && target.expressions.length === 0)
    return target.quasis[0]?.value.cooked ?? undefined
  if (target.type === 'ArrayExpression') {
    return target.elements.flatMap((element) => {
      const value = element && element.type !== 'SpreadElement'
        ? literal(element)
        : undefined
      return value === undefined
        ? []
        : [value]
    })
  }
  if (target.type === 'ObjectExpression') {
    const fields: Record<string, Value> = {}
    for (const property of target.properties) {
      if (property.type === 'SpreadElement' || property.kind !== 'init' || property.method || property.shorthand || property.computed)
        continue
      const key = property.key.type === 'Identifier'
        ? property.key.name
        : property.key.type === 'Literal' && typeof property.key.value === 'string'
          ? property.key.value
          : undefined
      const value = literal(property.value)
      if (key !== undefined && value !== undefined)
        fields[key] = value
    }
    return fields
  }
  return undefined
}

function isFields(value: Value | undefined): value is Fields {
  return typeof value === 'object' && !Array.isArray(value)
}

/** The object of `export default defineConfig({ ... })`, `module.exports = { ... }` or a `const` either one names. */
function exported(program: Program): Fields | undefined {
  const bindings = new Map<string, Node>()
  let root: Node | undefined
  for (const statement of program.body) {
    if (statement.type === 'VariableDeclaration') {
      for (const declarator of statement.declarations) {
        if (declarator.id.type === 'Identifier' && declarator.init)
          bindings.set(declarator.id.name, declarator.init)
      }
    }
    else if (statement.type === 'ExportDefaultDeclaration') {
      root = statement.declaration
    }
    else if (statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression' && statement.expression.left.type === 'MemberExpression'
      && statement.expression.left.object.type === 'Identifier' && statement.expression.left.object.name === 'module'
      && statement.expression.left.property.type === 'Identifier' && statement.expression.left.property.name === 'exports') {
      root = statement.expression.right
    }
  }
  const target = root && unwrap(root)
  const object = target?.type === 'Identifier'
    ? bindings.get(target.name)
    : target
  const value = object
    ? literal(object)
    : undefined
  return isFields(value)
    ? value
    : undefined
}

/** The i18next-cli config read statically, without running it; undefined without a config file. */
async function readCliConfig(host: ConfigContext['host']): Promise<Fields | undefined> {
  for (const file of configFiles) {
    const text = await host.readFile(file)
    if (text === undefined)
      continue
    const { parseSync } = await import('oxc-parser')
    return exported(parseSync(file, text, {
      lang: /\.[mc]?ts$/.test(file)
        ? 'ts'
        : 'js',
    }).program) ?? {}
  }
  return undefined
}

function text(value: Value | undefined): string | undefined {
  return typeof value === 'string'
    ? value
    : undefined
}

function texts(value: Value | undefined): string[] | undefined {
  if (typeof value === 'string')
    return [value]
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string')
    : undefined
}

/** `extract.output` as a resource pattern: `{{language}}` (or `{{lng}}`) is the locale, `{{namespace}}` a namespace that may hold folders. */
function outputPattern(output: string): string | undefined {
  const pattern = output
    .replace(/^\.\//, '')
    .replace(/\{\{(?:language|lng)\}\}/g, '{locale}')
    .replace(/\{\{namespace\}\}/g, '{namespaces}')
  return pattern.includes('{locale}') && !pattern.includes('{{')
    ? pattern
    : undefined
}

/** Translate calls named in `extract.functions`, `extract.transComponents` and `extract.useTranslationNames`. */
function cliCalls(extract: Fields): CallSpec[] {
  const calls: CallSpec[] = []
  // `*.t` matches any object; x18n callees are exact names, and the i18next preset already has `i18next.t` and `i18n.t`.
  for (const callee of texts(extract.functions) ?? []) {
    if (!callee.includes('*')) {
      calls.push({
        callee,
        namespace: { arg: 1, property: 'ns' },
        ...i18nextArgs,
      })
    }
  }
  for (const callee of texts(extract.transComponents) ?? []) {
    calls.push({
      callee,
      key: { arg: 0, property: 'i18nKey' },
      namespace: { arg: 0, property: 'ns' },
    })
  }
  const hooks = Array.isArray(extract.useTranslationNames)
    ? extract.useTranslationNames
    : []
  for (const hook of hooks) {
    const name = isFields(hook)
      ? text(hook.name)
      : text(hook)
    if (!name)
      continue
    // `-1` means the hook takes no such argument.
    const nsArg = isFields(hook) && typeof hook.nsArg === 'number'
      ? hook.nsArg
      : 0
    const keyPrefixArg = isFields(hook) && typeof hook.keyPrefixArg === 'number'
      ? hook.keyPrefixArg
      : 1
    calls.push({
      callee: name,
      factory: true,
      returns: ['t'],
      namespace: nsArg === -1
        ? undefined
        : { arg: nsArg },
      keyPrefix: keyPrefixArg === -1
        ? undefined
        : { arg: keyPrefixArg, property: 'keyPrefix' },
      ...i18nextArgs,
    })
  }
  return calls
}

/**
 * Reads `i18next.config.*` of i18next-cli, so its locales, output path, namespaces and translate functions need no x18n config.
 * Presets list it after their own plugins: its values replace the guesses of `findNamespaces`, and callees a preset declares stay as declared.
 * The user config is applied last and wins.
 */
export const i18nextCliPlugin: Plugin = {
  name: 'x18n:i18next-cli',
  async config(draft, ctx) {
    const config = await readCliConfig(ctx.host)
    if (!config)
      return
    const extract = isFields(config.extract)
      ? config.extract
      : {}
    const locales = texts(config.locales)
    if (locales?.length)
      draft.locales = locales
    const sourceLocale = text(extract.primaryLanguage) ?? locales?.[0]
    if (sourceLocale)
      draft.sourceLocale = sourceLocale
    // A function `output` cannot be read statically; the pattern finder then guesses as without it.
    const output = text(extract.output)
    const pattern = output
      ? outputPattern(output)
      : undefined
    if (pattern && !draft.resources.some(spec => spec.pattern === pattern)) {
      draft.resources = [
        ...draft.resources,
        { pattern },
      ]
    }
    // `keySeparator: false` makes keys literal (`Welcome back.`); `nsSeparator: false` lets them hold `:`.
    if (extract.keySeparator === false)
      draft.keySeparator = false
    else
      draft.keySeparator = text(extract.keySeparator) ?? draft.keySeparator
    draft.namespace = {
      ...draft.namespace,
      separator: extract.nsSeparator === false
        ? false
        : text(extract.nsSeparator) ?? draft.namespace.separator,
      default: extract.defaultNS === false
        ? undefined
        : text(extract.defaultNS) ?? draft.namespace.default,
      fallback: extract.fallbackNS === false
        ? []
        : texts(extract.fallbackNS) ?? draft.namespace.fallback,
    }
    const declared = new Set(draft.usage.calls.flatMap(spec => [spec.callee].flat()))
    draft.usage = {
      ...draft.usage,
      exclude: [
        ...draft.usage.exclude,
        ...texts(extract.ignore) ?? [],
      ],
      calls: [
        ...draft.usage.calls,
        ...cliCalls(extract).filter(spec => !declared.has(spec.callee as string)),
      ],
    }
  },
}
