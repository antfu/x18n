import type { ArgSource, CallSpec, HardString, ParamsSource, ScanResult, TextRange, UsageCandidate } from '@x18n/core'
import type { CallExpression, Comment, JSXElement, JSXOpeningElement, Node, ObjectExpression, Program, TSSignature } from 'oxc-parser'

/** Where a callee name came from: a declared spec, or a factory binding with its namespace and prefix. */
interface Binding {
  readonly spec: CallSpec
  readonly namespace?: string | undefined
  readonly keyPrefix?: string | undefined
}

/** The namespace and key prefix a usage carries. */
interface KeyBase {
  readonly namespace: string | undefined
  readonly keyPrefix: string | undefined
  /** The description written beside the key (`CallSpec.description`). */
  readonly description?: string | undefined
}

/** What a call passes besides the key: its params and a default value. */
interface CallDetails {
  readonly params?: readonly string[]
  readonly defaultValue?: string
}

/** A value read from call arguments: an AST node, or the props of a JSX element seen as one object argument. */
type ArgValue = Node | { readonly props: ReadonlyMap<string, Node> }

const textAttributeWords = new Set([
  'title',
  'subtitle',
  'label',
  'text',
  'placeholder',
  'alt',
  'content',
  'description',
  'caption',
  'message',
  'tooltip',
  'hint',
  'summary',
  'heading',
  'headline',
])

/**
 * Markup attributes whose values users read: those whose last word is a text word (`title`, `aria-label`,
 * `confirmText`, `empty-message`), plus `extract.attributes`. Every other attribute holds code: classes,
 * URLs, ids, SVG geometry, attributify utilities.
 */
export function isTextAttribute(name: string, extra: readonly string[] = []): boolean {
  const last = name.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase().split(/[-_:.]/).at(-1)!
  return textAttributeWords.has(last) || extra.includes(name)
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string' && 'start' in value
}

function isStringLiteral(node: Node | null | undefined): node is Extract<Node, { type: 'Literal', value: string }> {
  return node?.type === 'Literal' && typeof node.value === 'string'
}

/** Inner range of a quoted literal. */
function innerRange(node: Node): TextRange {
  return { start: node.start + 1, end: node.end - 1 }
}

function unwrap(node: Node): Node {
  let current = node
  while (current.type === 'TSAsExpression' || current.type === 'TSSatisfiesExpression' || current.type === 'TSNonNullExpression' || current.type === 'ParenthesizedExpression' || current.type === 'AwaitExpression' || current.type === 'ChainExpression') {
    current = current.type === 'AwaitExpression'
      ? current.argument
      : current.expression
  }
  return current
}

/** `a.b.c` for identifier and member chains, `this.` dropped; undefined for anything else. */
function calleeName(node: Node): string | undefined {
  const target = unwrap(node)
  if (target.type === 'Identifier')
    return target.name
  if (target.type === 'ThisExpression')
    return 'this'
  if (target.type === 'MemberExpression' && !target.computed && target.property.type === 'Identifier') {
    const object = calleeName(target.object)
    if (object === undefined)
      return undefined
    return object === 'this'
      ? target.property.name
      : `${object}.${target.property.name}`
  }
  return undefined
}

function jsxName(node: JSXOpeningElement['name']): string | undefined {
  if (node.type === 'JSXIdentifier')
    return node.name
  if (node.type === 'JSXMemberExpression') {
    const object = node.object.type === 'JSXIdentifier'
      ? node.object.name
      : node.object.type === 'JSXMemberExpression'
        ? jsxName(node.object)
        : undefined
    return object
      ? `${object}.${node.property.name}`
      : undefined
  }
  return undefined
}

function propertyName(node: Node): string | undefined {
  if (node.type === 'Identifier')
    return node.name
  if (isStringLiteral(node))
    return node.value
  return undefined
}

function objectProperty(object: ObjectExpression, name: string): Node | undefined {
  for (const property of object.properties) {
    if (property.type === 'Property' && !property.computed && propertyName(property.key) === name)
      return property.value
  }
  return undefined
}

class FileScan {
  readonly usages: UsageCandidate[] = []
  readonly keySlots: TextRange[] = []
  readonly hardStrings: HardString[] = []
  decorators = 0
  readonly frames: Map<string, Binding>[] = [
    new Map(),
  ]

  readonly constants = new Map<string, Node>()
  /** Several specs may share a callee, for example lingui `t('id')` and `t({ id })`. */
  readonly declared = new Map<string, CallSpec[]>()
  readonly factories = new Map<string, CallSpec[]>()
  readonly typed = new Map<string, CallSpec>()
  /** Members of the file's top-level interfaces and object type aliases, for typed props (`({ t }: Props)`). */
  readonly typeMembers = new Map<string, readonly TSSignature[]>()
  readonly consumed = new Set<number>()
  /** Render-prop functions of factory components (`<Translation>{t => ...}</Translation>`), by start offset. */
  readonly renderProps = new Map<number, Binding>()

  constructor(readonly text: string, readonly offset: number, calls: readonly CallSpec[], readonly collectHardStrings: boolean, readonly ignoredCallees: ReadonlySet<string> = new Set(), readonly textAttributes: readonly string[] = []) {
    for (const spec of calls) {
      for (const name of [spec.callee].flat()) {
        if (spec.factory) {
          const list = this.factories.get(name) ?? []
          this.factories.set(name, list)
          list.push(spec)
        }
        else if (spec.types?.length) {
          for (const type of spec.types)
            this.typed.set(type, spec)
          this.declare(name, spec)
        }
        else {
          this.declare(name, spec)
        }
      }
    }
  }

  range(range: TextRange): TextRange {
    return { start: range.start + this.offset, end: range.end + this.offset }
  }

  declare(name: string, spec: CallSpec): void {
    const list = this.declared.get(name) ?? []
    this.declared.set(name, list)
    list.push(spec)
  }

  lookup(name: string): Binding | undefined {
    return this.lookupAll(name)[0]
  }

  lookupAll(name: string): Binding[] {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const binding = this.frames[i]!.get(name)
      if (binding)
        return [binding]
    }
    const specs = this.declared.get(name)
    if (specs)
      return specs.map(spec => ({ spec }))
    // `t.rich` from a factory that returns `t.rich`, bound as `t`.
    const dot = name.indexOf('.')
    if (dot > 0) {
      const root = this.lookup(name.slice(0, dot))
      if (root?.spec.returns?.some(ret => ret.endsWith(name.slice(dot))))
        return [root]
    }
    return []
  }

  bind(name: string, binding: Binding): void {
    this.frames.at(-1)!.set(name, binding)
  }

  /** ---- Reading arguments ---- */
  stringArg(value: ArgValue | undefined): string | undefined {
    if (!value)
      return undefined
    if ('props' in value)
      return undefined
    const node = unwrap(value)
    if (isStringLiteral(node))
      return node.value
    if (node.type === 'ArrayExpression' && node.elements[0] && isStringLiteral(node.elements[0]))
      return node.elements[0].value
    if (node.type === 'JSXExpressionContainer' && node.expression.type !== 'JSXEmptyExpression')
      return this.stringArg(node.expression)
    if (node.type === 'Identifier') {
      const constant = this.constants.get(node.name)
      return constant && isStringLiteral(constant)
        ? constant.value
        : undefined
    }
    return undefined
  }

  /** A fixed namespace, or the one an argument holds. */
  namespaceArg(args: readonly ArgValue[], source: CallSpec['namespace'], fallback: number): string | undefined {
    if (typeof source === 'string')
      return source
    return source
      ? this.stringArg(this.argValues(args, source, fallback)[0])
      : undefined
  }

  argValues(args: readonly ArgValue[], source: ArgSource | number | undefined, fallback: number): ArgValue[] {
    const index = typeof source === 'number'
      ? source
      : source?.arg ?? fallback
    const arg = args[index]
    const property = typeof source === 'object'
      ? source.property
      : undefined
    if (!arg || property === undefined) {
      return arg
        ? [arg]
        : []
    }
    return property.split('.').reduce<ArgValue[]>((values, segment) => values.flatMap((value) => {
      if ('props' in value) {
        const prop = value.props.get(segment)
        return prop
          ? [prop]
          : []
      }
      const node = unwrap(value)
      if (node.type === 'JSXExpressionContainer' && node.expression.type === 'ObjectExpression') {
        return segment === '*'
          ? this.allValues(node.expression)
          : [
              objectProperty(node.expression, segment),
            ].filter(isNode)
      }
      if (node.type !== 'ObjectExpression')
        return []
      return segment === '*'
        ? this.allValues(node)
        : [
            objectProperty(node, segment),
          ].filter(isNode)
    }), [arg])
  }

  /** For a key read from a property: the description beside each key value, by the key's node. */
  descriptions(args: readonly ArgValue[], key: CallSpec['key'], name: string): Map<ArgValue, string> {
    const found = new Map<ArgValue, string>()
    if (typeof key !== 'object' || key.property === undefined)
      return found
    const segments = key.property.split('.')
    const last = segments.pop()!
    const holders = segments.length > 0
      ? this.argValues(args, {
          arg: key.arg,
          property: segments.join('.'),
        }, 0)
      : this.argValues(args, key.arg, 0)
    for (const holder of holders) {
      const value = this.argValues([holder], { arg: 0, property: last }, 0)[0]
      const description = this.stringArg(this.argValues([holder], { arg: 0, property: name }, 0)[0])
      if (value && description)
        found.set(value, description)
    }
    return found
  }

  /** The keys of the first object literal at the params positions; `[]` when there is none, undefined when unknown. */
  paramNames(args: readonly ArgValue[], source: ParamsSource): string[] | undefined {
    for (const index of [source.arg].flat()) {
      const value = args[index]
      if (!value)
        return []
      if ('props' in value)
        return undefined
      const node = unwrap(value)
      if (node.type === 'ObjectExpression')
        return this.staticKeys(node)
      if (!isStringLiteral(node) && node.type !== 'TemplateLiteral')
        return undefined
    }
    return []
  }

  /** Property names of an object literal, or undefined with a spread or a computed key. */
  staticKeys(object: ObjectExpression): string[] | undefined {
    const names: string[] = []
    for (const property of object.properties) {
      const name = property.type === 'Property' && !property.computed
        ? propertyName(property.key)
        : undefined
      if (name === undefined)
        return undefined
      names.push(name)
    }
    return names
  }

  callDetails(args: readonly ArgValue[], spec: CallSpec): CallDetails {
    const params = spec.params
      ? this.paramNames(args, spec.params)
      : undefined
    const defaultValue = spec.defaultValue
      ?.map(source => this.stringArg(this.argValues(args, source, 0)[0]))
      .find(value => value !== undefined)
    return {
      ...params
        ? { params }
        : {},
      ...defaultValue === undefined
        ? {}
        : { defaultValue },
    }
  }

  allValues(object: ObjectExpression): Node[] {
    return object.properties.flatMap(p => p.type === 'Property'
      ? [p.value]
      : [])
  }

  /** ---- Usages ---- */
  /** `expression` is the call holding `value`, kept only when the key is the call's own literal. */
  addKey(value: ArgValue, base: KeyBase, expression?: TextRange, details?: CallDetails): void {
    if ('props' in value)
      return
    const node = unwrap(value)
    const call = expression
      ? {
          expression: this.range(expression),
          ...details,
        }
      : {}
    if (isStringLiteral(node)) {
      this.consumed.add(node.start)
      this.keySlots.push(this.range(innerRange(node)))
      this.usages.push({
        ...base,
        ...call,
        raw: node.value,
        range: this.range(innerRange(node)),
        kind: 'call',
        dynamic: false,
      })
      return
    }
    if (node.type === 'JSXExpressionContainer') {
      if (node.expression.type !== 'JSXEmptyExpression')
        this.addKey(node.expression, base)
      return
    }
    if (node.type === 'TemplateLiteral') {
      const first = node.quasis[0]!
      const raw = first.value.cooked ?? first.value.raw
      this.consumed.add(node.start)
      const range = this.range({ start: node.start + 1, end: node.start + 1 + raw.length })
      this.usages.push({
        ...base,
        ...call,
        raw,
        range,
        kind: 'call',
        dynamic: node.expressions.length === 0
          ? false
          : raw ? 'prefix' : 'unknown',
      })
      return
    }
    if (node.type === 'ConditionalExpression') {
      this.addKey(node.consequent, base)
      this.addKey(node.alternate, base)
      return
    }
    if (node.type === 'ArrowFunctionExpression' && node.params[0]?.type === 'Identifier')
      return this.addSelector(node.params[0].name, node.body, base)
    const constant = node.type === 'Identifier'
      ? this.constants.get(node.name)
      : node.type === 'MemberExpression'
        ? this.memberConstant(node)
        : undefined
    if (constant && isStringLiteral(constant)) {
      this.usages.push({
        ...base,
        raw: constant.value,
        range: this.range(innerRange(constant)),
        kind: 'constant',
        dynamic: false,
      })
      return
    }
    this.addUnknown(node, base)
  }

  addUnknown(node: Node, base: KeyBase): void {
    if (isStringLiteral(node))
      this.consumed.add(node.start)
    this.usages.push({
      ...base,
      raw: this.text.slice(node.start, node.end),
      range: this.range({ start: node.start, end: node.end }),
      kind: 'call',
      dynamic: 'unknown',
    })
  }

  /** i18next `t($ => $.a.b)`. */
  addSelector(param: string, body: Node, base: KeyBase): void {
    const segments: string[] = []
    let node = unwrap(body)
    let end = node.end
    while (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
      segments.unshift(node.property.name)
      node = unwrap(node.object)
    }
    if (node.type !== 'Identifier' || node.name !== param || segments.length === 0)
      return
    const start = node.end + 1
    end = Math.max(end, start)
    this.usages.push({
      ...base,
      raw: segments.join('.'),
      range: this.range({ start, end }),
      kind: 'selector',
      dynamic: false,
    })
  }

  memberConstant(node: Extract<Node, { type: 'MemberExpression' }>): Node | undefined {
    if (node.computed || node.property.type !== 'Identifier' || node.object.type !== 'Identifier')
      return undefined
    const object = this.constants.get(node.object.name)
    return object && object.type === 'ObjectExpression'
      ? objectProperty(object, node.property.name)
      : undefined
  }

  handleCall(name: string, args: readonly ArgValue[], expression?: TextRange): boolean {
    const bindings = this.lookupAll(name).filter(binding => !binding.spec.factory)
    for (const binding of bindings) {
      const namespace = this.namespaceArg(args, binding.spec.namespace, 1)
      const keyPrefix = binding.spec.keyPrefix
        ? this.stringArg(this.argValues(args, binding.spec.keyPrefix, 1)[0])
        : undefined
      const base = {
        namespace: namespace ?? binding.namespace,
        keyPrefix: keyPrefix ?? binding.keyPrefix,
      }
      const descriptions = binding.spec.description === undefined
        ? undefined
        : this.descriptions(args, binding.spec.key, binding.spec.description)
      for (const value of this.argValues(args, binding.spec.key, 0)) {
        if ('props' in value)
          continue
        // With several specs per callee, only the one whose key position holds a key counts.
        if (bindings.length > 1 && unwrap(value).type === 'ObjectExpression')
          continue
        // Without its prefix argument (`t(getPrefix(), 'title')`) the key would read as another key.
        if (binding.spec.keyPrefix && keyPrefix === undefined) {
          this.addUnknown(unwrap(value), base)
        }
        else {
          const description = descriptions?.get(value)
          this.addKey(value, description === undefined
            ? base
            : { ...base, description }, expression, expression && this.callDetails(args, binding.spec))
        }
      }
    }
    return bindings.length > 0
  }

  call(node: CallExpression): void {
    const name = calleeName(node.callee)
    if (name !== undefined)
      this.handleCall(name, node.arguments, { start: node.start, end: node.end })
  }

  jsxProps(node: JSXOpeningElement): ArgValue {
    const props = new Map<string, Node>()
    for (const attribute of node.attributes) {
      if (attribute.type === 'JSXAttribute' && attribute.value && attribute.name.type === 'JSXIdentifier') {
        props.set(attribute.name.name, attribute.value)
        if (isStringLiteral(attribute.value))
          this.consumed.add(attribute.value.start)
      }
    }
    return { props }
  }

  jsx(node: JSXOpeningElement): void {
    const name = jsxName(node.name)
    if (name && this.lookup(name)) {
      this.handleCall(name, [
        this.jsxProps(node),
      ])
    }
  }

  jsxElement(node: JSXElement): void {
    const name = jsxName(node.openingElement.name)
    const specs = name
      ? this.factories.get(name)
      : undefined
    if (!specs)
      return
    const binding = this.pickFactory([
      this.jsxProps(node.openingElement),
    ], specs)
    for (const child of node.children) {
      if (child.type === 'JSXExpressionContainer' && (child.expression.type === 'ArrowFunctionExpression' || child.expression.type === 'FunctionExpression'))
        this.renderProps.set(child.expression.start, binding)
    }
  }

  /** ---- Bindings ---- */
  declarator(id: Node, init: Node | null): void {
    if (!init)
      return
    const value = unwrap(init)
    if (id.type === 'Identifier' && (isStringLiteral(value) || value.type === 'ObjectExpression'))
      this.constants.set(id.name, value)
    if (value.type === 'CallExpression') {
      const factory = calleeName(value.callee)
      const specs = factory
        ? this.factories.get(factory)
        : undefined
      if (specs)
        this.bindFactory(id, value.arguments, specs)
      return
    }
    // `const tt = t`
    if (id.type === 'Identifier' && (value.type === 'Identifier' || value.type === 'MemberExpression')) {
      const name = calleeName(value)
      const binding = name
        ? this.lookup(name)
        : undefined
      if (binding)
        this.bind(id.name, binding)
    }
  }

  /** The first factory spec whose namespace and prefix sources all resolve, else the first spec. */
  pickFactory(args: readonly ArgValue[], specs: readonly CallSpec[]): Binding {
    const resolved = specs.map((spec) => {
      const namespace = this.namespaceArg(args, spec.namespace, 0)
      const keyPrefix = spec.keyPrefix
        ? this.stringArg(this.argValues(args, spec.keyPrefix, 0)[0])
        : undefined
      const complete = (!spec.namespace || namespace !== undefined) && (!spec.keyPrefix || keyPrefix !== undefined)
      return {
        binding: {
          spec: {
            callee: spec.callee,
            returns: spec.returns,
            params: spec.params,
            defaultValue: spec.defaultValue,
            description: spec.description,
          },
          namespace,
          keyPrefix,
        },
        complete,
      }
    })
    return (resolved.find(r => r.complete) ?? resolved[0]!).binding
  }

  bindFactory(id: Node, args: readonly ArgValue[], specs: readonly CallSpec[]): void {
    const binding = this.pickFactory(args, specs)
    const returns = (binding.spec.returns ?? ['t']).filter(name => !name.includes('.'))
    if (id.type === 'Identifier') {
      this.bind(id.name, binding)
      return
    }
    if (id.type !== 'ObjectPattern')
      return
    for (const property of id.properties) {
      if (property.type !== 'Property')
        continue
      const key = propertyName(property.key)
      const local = unwrap(property.value)
      if (key && returns.includes(key) && local.type === 'Identifier')
        this.bind(local.name, binding)
      // `const { i18n } = useTranslation()` gives `i18n.t`.
      if (key && local.type === 'Identifier' && this.declared.has(`${key}.t`))
        this.bind(`${local.name}.t`, binding)
    }
  }

  /** Parameters typed as a translate function (`t: TFunction<'ns'>`), also as destructured props. */
  params(params: readonly Node[]): void {
    for (const param of params) {
      const target = param.type === 'TSParameterProperty'
        ? param.parameter
        : param
      const annotation = target.type === 'Identifier' || target.type === 'ObjectPattern'
        ? target.typeAnnotation?.typeAnnotation
        : undefined
      if (!annotation)
        continue
      if (target.type === 'Identifier')
        this.bindTyped(target.name, annotation)
      else if (target.type === 'ObjectPattern')
        this.props(target, annotation)
    }
  }

  /** `({ t }: { t: TFunction<'ns'> })`, or with an interface or type of the file. */
  props(pattern: Extract<Node, { type: 'ObjectPattern' }>, annotation: Node): void {
    const members = annotation.type === 'TSTypeLiteral'
      ? annotation.members
      : annotation.type === 'TSTypeReference' && annotation.typeName.type === 'Identifier'
        ? this.typeMembers.get(annotation.typeName.name) ?? []
        : []
    for (const property of pattern.properties) {
      if (property.type !== 'Property')
        continue
      const local = unwrap(property.value)
      const name = propertyName(property.key)
      const member = members.find(m => m.type === 'TSPropertySignature' && !m.computed && propertyName(m.key) === name)
      const type = member?.type === 'TSPropertySignature'
        ? member.typeAnnotation?.typeAnnotation
        : undefined
      if (local.type === 'Identifier' && type)
        this.bindTyped(local.name, type)
    }
  }

  /** The namespace is the first type argument: `TFunction<'shared'>` or `TFunction<['shared', 'common']>`. */
  bindTyped(name: string, annotation: Node): void {
    if (annotation.type !== 'TSTypeReference' || annotation.typeName.type !== 'Identifier')
      return
    const spec = this.typed.get(annotation.typeName.name)
    if (!spec)
      return
    const arg = annotation.typeArguments?.params[0]
    const first = arg?.type === 'TSTupleType'
      ? arg.elementTypes[0]
      : arg
    const namespace = first?.type === 'TSLiteralType' && isStringLiteral(first.literal)
      ? first.literal.value
      : undefined
    this.bind(name, {
      spec: { ...spec, types: undefined },
      namespace,
    })
  }

  types(program: Program): void {
    for (const statement of program.body) {
      const node = statement.type === 'ExportNamedDeclaration' && statement.declaration
        ? statement.declaration
        : statement
      if (node.type === 'TSInterfaceDeclaration')
        this.typeMembers.set(node.id.name, node.body.body)
      else if (node.type === 'TSTypeAliasDeclaration' && node.typeAnnotation.type === 'TSTypeLiteral')
        this.typeMembers.set(node.id.name, node.typeAnnotation.members)
    }
  }

  importSpecifier(node: Extract<Node, { type: 'ImportSpecifier' }>): void {
    const imported = node.imported.type === 'Identifier'
      ? node.imported.name
      : node.imported.value
    const spec = this.declared.get(imported)?.[0]
    if (spec && imported !== node.local.name)
      this.bind(node.local.name, { spec })
  }

  /** ---- Hard strings ---- */
  hard(text: string, range: TextRange, kind: string, attribute?: string): void {
    if (!this.collectHardStrings || !/\p{L}/u.test(text))
      return
    this.hardStrings.push({
      text,
      range: this.range(range),
      kind,
      ...attribute
        ? { attribute }
        : {},
    })
  }

  ignoredCall(name: string | undefined): boolean {
    return name !== undefined && (name.startsWith('console.') || name === 'require' || this.ignoredCallees.has(name))
  }

  /** ---- Walk ---- */
  walk(node: Node, parent: Node | undefined, parentKey: string): void {
    if (node.type === 'Decorator')
      this.decorators++
    const scoped = node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression' || node.type === 'BlockStatement'
    if (scoped)
      this.frames.push(new Map())
    this.visit(node, parent, parentKey)
    for (const [key, child] of Object.entries(node)) {
      if (key === 'parent')
        continue
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isNode(item))
            this.walk(item, node, key)
        }
      }
      else if (isNode(child)) {
        this.walk(child, node, key)
      }
    }
    if (scoped)
      this.frames.pop()
    if (node.type === 'Decorator')
      this.decorators--
  }

  visit(node: Node, parent: Node | undefined, parentKey: string): void {
    switch (node.type) {
      case 'CallExpression':
        this.call(node)
        break
      case 'JSXElement':
        this.jsxElement(node)
        break
      case 'JSXOpeningElement':
        this.jsx(node)
        break
      case 'VariableDeclarator':
        this.declarator(node.id, node.init)
        break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        this.params(node.params)
        const binding = this.renderProps.get(node.start)
        if (binding && node.params[0]?.type === 'Identifier')
          this.bind(node.params[0].name, binding)
        break
      }
      case 'ImportSpecifier':
        this.importSpecifier(node)
        break
      case 'JSXText': {
        const text = node.value.trim()
        if (text)
          this.hard(text, { start: node.start + node.value.indexOf(text), end: node.start + node.value.indexOf(text) + text.length }, 'jsx-text')
        break
      }
      case 'Literal':
      case 'TemplateLiteral':
        this.literal(node, parent, parentKey)
        break
    }
  }

  literal(node: Node, parent: Node | undefined, parentKey: string): void {
    if (this.consumed.has(node.start) || !parent)
      return
    if (parent.type === 'JSXAttribute') {
      const name = parent.name.type === 'JSXIdentifier'
        ? parent.name.name
        : ''
      // The range covers the whole attribute, which templates such as `{attr}={t('{key}')}` replace.
      if (isStringLiteral(node) && isTextAttribute(name, this.textAttributes))
        this.hard(node.value, { start: parent.start, end: parent.end }, 'jsx-attribute', name)
      return
    }
    // A tag such as `$localize`, `gql` or `css` already says what the template is.
    const ignoredParent = parent.type === 'TaggedTemplateExpression' || parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration'
      || parent.type === 'TSLiteralType' || parent.type === 'ImportExpression' || parent.type === 'TSExternalModuleReference' || parent.type === 'TSModuleDeclaration'
      || (parent.type === 'Property' && parentKey === 'key') || (parent.type === 'MemberExpression' && parentKey === 'property')
      || parent.type === 'ExpressionStatement' || parent.type === 'BinaryExpression' || parent.type === 'SwitchCase'
      || (parent.type === 'CallExpression' && this.ignoredCall(calleeName(parent.callee)))
      // `template: '<p>Hi</p>'` in a component, or any `template` of a decorator, is markup and not a message.
      || (parent.type === 'Property' && parent.key.type === 'Identifier' && parent.key.name === 'template' && (this.decorators > 0 || this.text.slice(node.start, node.end).includes('<')))
    if (ignoredParent)
      return
    if (isStringLiteral(node))
      this.hard(node.value, { start: node.start, end: node.end }, 'js-string')
    else if (node.type === 'TemplateLiteral')
      this.template(node)
  }

  /** `Hello ${user.name}` becomes `Hello {0}` with the argument `name: user.name`. */
  template(node: Extract<Node, { type: 'TemplateLiteral' }>): void {
    if (!this.collectHardStrings)
      return
    const args = node.expressions.map((expression, i) => {
      const source = this.text.slice(expression.start, expression.end)
      const name = expression.type === 'Identifier'
        ? expression.name
        : expression.type === 'MemberExpression' && expression.property.type === 'Identifier'
          ? expression.property.name
          : `arg${i}`
      return { name, expression: source }
    })
    const text = node.quasis.map((q, i) => `${q.value.cooked ?? q.value.raw}${i < args.length
      ? `{${i}}`
      : ''}`).join('')
    if (/\p{L}/u.test(text)) {
      this.hardStrings.push({
        text,
        range: this.range({ start: node.start, end: node.end }),
        kind: 'js-template',
        args,
      })
    }
  }

  markers(program: Program, comments: readonly Comment[]): void {
    for (const comment of comments) {
      const marker = /@x18n-keys?\b/.exec(comment.value)?.[0]
      if (!marker)
        continue
      const next = this.firstAfter(program, comment.end)
      if (!next)
        continue
      const literals = marker === '@x18n-keys'
        ? this.literalsIn(next)
        : isStringLiteral(next)
          ? [next]
          : []
      for (const literal of literals) {
        if (isStringLiteral(literal)) {
          this.usages.push({
            raw: literal.value,
            range: this.range(innerRange(literal)),
            kind: 'marker',
            dynamic: false,
          })
        }
      }
    }
  }

  firstAfter(root: Node, offset: number): Node | undefined {
    let best: Node | undefined
    const visit = (node: Node): void => {
      if (node.end <= offset || (best && node.start > best.start))
        return
      if (node.start >= offset && (node.type === 'Literal' || node.type === 'ArrayExpression' || node.type === 'ObjectExpression')) {
        if (!best || node.start < best.start)
          best = node
        return
      }
      for (const [key, child] of Object.entries(node)) {
        if (key === 'parent')
          continue
        for (const item of [child].flat()) {
          if (isNode(item))
            visit(item)
        }
      }
    }
    visit(root)
    return best
  }

  literalsIn(node: Node): Node[] {
    if (isStringLiteral(node))
      return [node]
    if (node.type === 'ArrayExpression') {
      return node.elements.flatMap(element => element
        ? this.literalsIn(element)
        : [])
    }
    if (node.type === 'ObjectExpression')
      return this.allValues(node).flatMap(value => this.literalsIn(value))
    return []
  }

  result(): ScanResult {
    return { usages: this.usages, keySlots: this.keySlots, hardStrings: this.hardStrings }
  }
}

type ParseSync = typeof import('oxc-parser').parseSync
let parser: Promise<ParseSync> | undefined

/** Loads oxc lazily: native in Node, WASM through the package's browser export. */
export function loadParser(): Promise<ParseSync> {
  parser ??= import('oxc-parser').then(mod => mod.parseSync)
  return parser
}

export interface ScanSourceOptions {
  readonly calls: readonly CallSpec[]
  /** Offset of `text` in the file, for embedded code such as Vue `<script>`. */
  readonly offset?: number
  readonly hardStrings?: boolean
  /** File name for the parser; picks JS, TS or JSX. */
  readonly filename: string
  /** Parse `text` as one expression (template interpolations). */
  readonly expression?: boolean
  /** Callees whose string arguments are never hard strings (`extract.ignoreCallees`). */
  readonly ignoreCallees?: readonly string[] | undefined
  /** Attributes whose values are text, on top of the built-in ones (`extract.attributes`). */
  readonly textAttributes?: readonly string[] | undefined
}

export function scanSource(parse: ParseSync, text: string, options: ScanSourceOptions): ScanResult {
  const source = options.expression
    ? `(${text})`
    : text
  const shift = options.expression
    ? -1
    : 0
  const result = parse(options.filename, source, { sourceType: 'module', range: false })
  const scan = new FileScan(source, (options.offset ?? 0) + shift, options.calls, options.hardStrings !== false, new Set(options.ignoreCallees), options.textAttributes)
  scan.types(result.program)
  scan.walk(result.program, undefined, '')
  scan.markers(result.program, result.comments)
  return scan.result()
}
