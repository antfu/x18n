import type {
  ArgSource,
  CallSpec,
  CheckSetting,
  ExtractOptions,
  ExtractTemplate,
  GlossaryEntry,
  KeySeparator,
  NamespaceOptions,
  ParamsSource,
  RegexScannerSpec,
  ResourceSpec,
  SerializableConfig,
} from './types/config'
import type { JsonObject, JsonValue } from './types/model'
import type { ReviewAuthor, ReviewComment, ReviewData } from './types/review'
import * as v from 'valibot'

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return true
  if (Array.isArray(value))
    return value.every(isJsonValue)
  return isJsonObject(value)
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(isJsonValue)
}

const jsonObject = v.custom<JsonObject>(isJsonObject, 'Expected a JSON object')
const strings = v.array(v.string())
const level = v.picklist([
  'error',
  'warning',
  'info',
  'hint',
  'off',
])

const argSource = v.strictObject({
  arg: v.number(),
  property: v.optional(v.string()),
}) satisfies v.GenericSchema<ArgSource>

const paramsSource = v.strictObject({
  arg: v.union([
    v.number(),
    v.array(v.number()),
  ]),
  options: v.optional(strings),
}) satisfies v.GenericSchema<ParamsSource>

const callSpec = v.strictObject({
  callee: v.union([
    v.string(),
    strings,
  ]),
  kind: v.optional(v.picklist(['call', 'selector', 'accessor'])),
  key: v.optional(v.union([
    v.number(),
    argSource,
  ])),
  namespace: v.optional(v.union([
    argSource,
    v.string(),
  ])),
  keyPrefix: v.optional(argSource),
  params: v.optional(paramsSource),
  defaultValue: v.optional(v.array(argSource)),
  description: v.optional(v.string()),
  factory: v.optional(v.boolean()),
  returns: v.optional(strings),
  types: v.optional(strings),
}) satisfies v.GenericSchema<CallSpec>

const regexSpec = v.strictObject({
  extensions: strings,
  patterns: strings,
}) satisfies v.GenericSchema<RegexScannerSpec>

const keySeparator = v.union([
  v.pipe(v.string(), v.minLength(1)),
  v.literal(false),
]) satisfies v.GenericSchema<KeySeparator>

const resourceSpec = v.strictObject({
  pattern: v.string(),
  format: v.optional(v.string()),
  namespace: v.optional(v.string()),
  locale: v.optional(v.string()),
  execute: v.optional(v.boolean()),
  keySeparator: v.optional(keySeparator),
}) satisfies v.GenericSchema<ResourceSpec>

const pluginSpecifier = v.union([
  v.string(),
  v.tuple([
    v.string(),
    jsonObject,
  ]),
])

const extractTemplate = v.strictObject({
  template: v.string(),
  kinds: v.optional(strings),
  files: v.optional(strings),
  imports: v.optional(strings),
}) satisfies v.GenericSchema<ExtractTemplate>

const extractTemplates = v.array(v.union([
  v.string(),
  extractTemplate,
]))

const extractOptions = v.strictObject({
  autoDetect: v.optional(v.boolean()),
  keygen: v.optional(v.picklist(['slug', 'source', 'random', 'empty'])),
  keyCase: v.optional(v.picklist(['camel', 'snake', 'kebab', 'dot'])),
  keyPrefix: v.optional(v.string()),
  keyMaxLength: v.optional(v.number()),
  reuseExisting: v.optional(v.boolean()),
  ignore: v.optional(strings),
  ignoreByFile: v.optional(v.record(v.string(), strings)),
  attributes: v.optional(strings),
  ignoreAttributes: v.optional(strings),
  ignoreCallees: v.optional(strings),
  templates: v.optional(extractTemplates),
}) satisfies v.GenericSchema<ExtractOptions>

const glossaryEntry = v.strictObject({
  term: v.string(),
  translations: v.optional(v.record(v.string(), v.string())),
  forms: v.optional(v.record(v.string(), v.array(v.string()))),
  note: v.optional(v.string()),
  doNotTranslate: v.optional(v.boolean()),
}) satisfies v.GenericSchema<GlossaryEntry>

const checkSetting = v.union([
  level,
  v.tuple([level, jsonObject]),
]) satisfies v.GenericSchema<CheckSetting>

const namespaceOptions = v.strictObject({
  separator: v.optional(v.union([
    v.pipe(v.string(), v.minLength(1)),
    v.literal(false),
  ])),
  default: v.optional(v.string()),
  fallback: v.optional(strings),
  byFile: v.optional(v.record(v.string(), v.string())),
  fromPath: v.optional(v.picklist(['dot', 'slash', 'camel'])),
}) satisfies v.GenericSchema<NamespaceOptions>

const reviewAuthor = v.strictObject({
  name: v.optional(v.string()),
  email: v.optional(v.string()),
}) satisfies v.GenericSchema<ReviewAuthor>

const configSchema = v.strictObject({
  $schema: v.optional(v.string()),
  root: v.optional(v.string()),
  name: v.optional(v.string()),
  sourceLocale: v.optional(v.string()),
  locales: v.optional(strings),
  ignoreLocales: v.optional(strings),
  localeFallbacks: v.optional(v.union([
    v.literal('auto'),
    v.record(v.string(), v.string()),
  ])),
  presets: v.optional(v.union([
    v.literal('auto'),
    v.array(pluginSpecifier),
  ])),
  plugins: v.optional(v.array(pluginSpecifier)),
  resources: v.optional(v.array(resourceSpec)),
  formats: v.optional(v.record(v.string(), v.string())),
  keyStyle: v.optional(v.picklist(['auto', 'nested', 'flat'])),
  keySeparator: v.optional(keySeparator),
  namespace: v.optional(namespaceOptions),
  usage: v.optional(v.strictObject({
    include: v.optional(strings),
    exclude: v.optional(strings),
    gitignore: v.optional(v.boolean()),
    calls: v.optional(v.array(callSpec)),
    regex: v.optional(v.array(regexSpec)),
    ignoreCallees: v.optional(strings),
    keysInUse: v.optional(strings),
    derivedKeys: v.optional(strings),
  })),
  write: v.optional(v.strictObject({
    sort: v.optional(v.union([
      v.literal(false),
      v.picklist(['binary', 'locale']),
    ])),
    indent: v.optional(v.union([
      v.number(),
      v.literal('tab'),
    ])),
    keepFilled: v.optional(v.boolean()),
  })),
  extract: v.optional(extractOptions),
  typegen: v.optional(v.union([
    v.boolean(),
    v.strictObject({
      output: v.optional(v.string()),
    }),
  ])),
  checks: v.optional(v.record(v.string(), checkSetting)),
  strict: v.optional(v.boolean()),
  ignoreKeys: v.optional(strings),
  glossary: v.optional(v.array(glossaryEntry)),
  // Provider options are typed by each provider; core only knows they are keyed by provider.
  history: v.optional(v.union([
    v.boolean(),
    v.record(v.string(), v.union([
      v.literal(false),
      v.looseObject({}),
    ])),
  ])),
  review: v.optional(v.strictObject({
    enabled: v.optional(v.boolean()),
    file: v.optional(v.string()),
    author: v.optional(reviewAuthor),
  })),
  projects: v.optional(strings),
})

/** Validates YAML and JSON configs, and the serializable part of TS configs. */
export const ConfigSchema: v.GenericSchema<SerializableConfig> = configSchema

/** A YAML plugin (`*.x18n-plugin.yml`): the declarative subset of the plugin API. */
export interface PluginFile {
  readonly $schema?: string | undefined
  readonly name: string
  readonly detect?: {
    readonly dependencies?: { readonly any?: readonly string[] | undefined, readonly all?: readonly string[] | undefined } | undefined
    readonly files?: readonly string[] | undefined
  } | undefined
  readonly exclusive?: boolean | undefined
  readonly config?: {
    readonly sourceLocale?: string | undefined
    readonly locales?: readonly string[] | undefined
    readonly resources?: readonly ResourceSpec[] | undefined
    readonly namespace?: NamespaceOptions | undefined
    readonly keyStyle?: 'auto' | 'nested' | 'flat' | undefined
    readonly keySeparator?: KeySeparator | undefined
  } | undefined
  readonly scanners?: {
    readonly calls?: readonly CallSpec[] | undefined
    readonly regex?: readonly RegexScannerSpec[] | undefined
  } | undefined
  readonly scopes?: {
    /** Regex whose first group is the namespace of the code after it (i18n-ally `scopeRangeRegex`). */
    readonly regex: string
  } | undefined
  readonly derivedKeys?: readonly string[] | undefined
  readonly normalizeKey?: readonly { readonly replace: { readonly pattern: string, readonly with: string } }[] | undefined
  /** Placeholder shapes with `name` as the name: `{name}`, `{{name}}`, `%{name}`. */
  readonly placeholders?: readonly string[] | undefined
  readonly localeInfo?: { readonly [code: string]: { readonly flag?: string | undefined, readonly displayName?: string | undefined } } | undefined
  readonly extract?: { readonly templates?: readonly (string | ExtractTemplate)[] | undefined } | undefined
}

const pluginFileSchema = v.strictObject({
  $schema: v.optional(v.string()),
  name: v.string(),
  detect: v.optional(v.strictObject({
    dependencies: v.optional(v.strictObject({
      any: v.optional(strings),
      all: v.optional(strings),
    })),
    files: v.optional(strings),
  })),
  exclusive: v.optional(v.boolean()),
  config: v.optional(v.strictObject({
    sourceLocale: v.optional(v.string()),
    locales: v.optional(strings),
    resources: v.optional(v.array(resourceSpec)),
    namespace: v.optional(namespaceOptions),
    keyStyle: v.optional(v.picklist(['auto', 'nested', 'flat'])),
    keySeparator: v.optional(keySeparator),
  })),
  scanners: v.optional(v.strictObject({
    calls: v.optional(v.array(callSpec)),
    regex: v.optional(v.array(regexSpec)),
  })),
  scopes: v.optional(v.strictObject({
    regex: v.string(),
  })),
  derivedKeys: v.optional(strings),
  normalizeKey: v.optional(v.array(v.strictObject({
    replace: v.strictObject({
      pattern: v.string(),
      with: v.string(),
    }),
  }))),
  placeholders: v.optional(strings),
  localeInfo: v.optional(v.record(v.string(), v.strictObject({
    flag: v.optional(v.string()),
    displayName: v.optional(v.string()),
  }))),
  extract: v.optional(v.strictObject({
    templates: v.optional(extractTemplates),
  })),
})

export const PluginFileSchema: v.GenericSchema<PluginFile> = pluginFileSchema

/** The review file (`.x18n/reviews.yml`), as the YAML review store reads it. */
export interface ReviewFile {
  readonly $schema?: string | undefined
  /** File format version. */
  readonly x18n: 1
  readonly threads?: ReviewData['threads'] | undefined
  readonly sources?: ReviewData['sources'] | undefined
}

const reviewComment = v.strictObject({
  id: v.string(),
  type: v.picklist([
    'comment',
    'approve',
    'request-change',
    'suggestion',
  ]),
  author: v.optional(reviewAuthor),
  time: v.string(),
  text: v.optional(v.string()),
  suggestion: v.optional(v.string()),
  value: v.optional(v.string()),
  resolved: v.optional(v.boolean()),
}) satisfies v.GenericSchema<ReviewComment>

const reviewFileSchema = v.strictObject({
  $schema: v.optional(v.string()),
  x18n: v.literal(1),
  threads: v.optional(v.record(v.string(), v.record(v.string(), v.array(reviewComment)))),
  sources: v.optional(v.record(v.string(), v.record(v.string(), v.string()))),
})

export const ReviewFileSchema: v.GenericSchema<ReviewFile> = reviewFileSchema

export interface SchemaIssue {
  readonly path: string
  readonly message: string
}

/** Validates data against a schema and returns readable issues instead of throwing. */
export function validate<T>(schema: v.GenericSchema<T>, data: unknown): { readonly success: true, readonly output: T } | { readonly success: false, readonly issues: readonly SchemaIssue[] } {
  const result = v.safeParse(schema, data)
  if (result.success)
    return { success: true, output: result.output }
  return {
    success: false,
    issues: result.issues.map(issue => ({
      path: issue.path?.map(item => String(item.key)).join('.') ?? '',
      message: issue.message,
    })),
  }
}
