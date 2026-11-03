import type { PluginRegistry } from '../plugins'
import type { KeySeparator, ResolvedConfig } from '../types/config'
import type { FileEvent, Host } from '../types/host'
import type { EditOp, ExtractItem, KeyString, LocaleCode, Message, MessageLeaf, MessageTree, Resource, TextEdit, Usage } from '../types/model'
import type { Format, KeyFile, MessageOp } from '../types/plugin'
import type { Answers, ApplyResult, Decision, FileChange, Plan, ProjectChange, UsageMatch } from '../types/project'
import type { ReviewData, ReviewStore } from '../types/review'
import type { ResourceState } from './analysis'
import { errors } from '../errors'
import { isKeyUnder, keyJoiner, keySeparatorOf, replaceKeyPrefix, splitKey, splitKeyPath, splitNamespace } from '../keys'
import { applyMessageOps, isMessageLeaf, pathId, sortTree, walkLeaves } from '../message-tree'
import { applyTextEdits, diffText, hashText } from '../text'
import { findReview, noReviews, ReviewDraft, reviewId, sortReviews, sourceHash, valueText } from './reviews'

interface PlannerState {
  readonly revision: number
  readonly sourceLocale: LocaleCode
  readonly locales: readonly LocaleCode[]
  readonly fallbacks: Readonly<Record<LocaleCode, LocaleCode>>
  readonly namespaced: boolean
  readonly resources: readonly ResourceState[]
  readonly fileTexts: ReadonlyMap<string, string>
  /** Undefined when reviews are off or the review file cannot be read; `reviewProblem` says why. */
  readonly reviews: ReviewSource | undefined
  readonly reviewProblem: string | undefined
}

export interface ReviewSource {
  readonly store: ReviewStore
  readonly file: string
  /** Undefined while the file does not exist. */
  readonly text: string | undefined
  readonly data: ReviewData
}

export interface PlannerOptions {
  readonly host: Host
  readonly config: ResolvedConfig
  readonly registry: PluginRegistry
  readonly state: () => PlannerState
  readonly message: (key: KeyString, locale: LocaleCode) => Message | undefined
  readonly messages: (key: KeyString) => ReadonlyMap<LocaleCode, readonly Message[]> | undefined
  readonly allKeys: () => readonly KeyString[]
  readonly parents: () => ReadonlySet<KeyString>
  readonly usageMatches: (query: { key?: KeyString, prefix?: KeyString }) => UsageMatch[]
  readonly text: (path: string) => string | undefined
  readonly basesOf: (key: KeyString) => readonly KeyString[]
  /** Stored path of a key path in a (maybe new) resource, through resource transforms. */
  readonly toStored: (target: { readonly path: string, readonly locale: LocaleCode, readonly namespace: string | undefined }, path: readonly string[]) => string[]
  /** A path for a new resource from the locale finders' `resolveNew`. */
  readonly resolveNew: (locale: LocaleCode, namespace: string | undefined, model: Resource | undefined) => string | undefined
  /** The file of one key from the locale finders' `resolveKey`. */
  readonly resolveKey: (key: KeyString, locale: LocaleCode) => KeyFile | undefined
  readonly update: (events: readonly FileEvent[]) => Promise<ProjectChange | undefined>
}

interface Target {
  readonly id: string
  readonly path: string
  readonly locale: LocaleCode
  readonly namespace: string | undefined
  readonly keySeparator?: KeySeparator | undefined
  readonly format: Format
  /** Set for resources that already exist. */
  readonly state: ResourceState | undefined
}

interface Work {
  readonly target: Target
  tree: MessageTree
  readonly ops: MessageOp[]
  /** In-place renames of the last key segment: the key text range and the new text. */
  readonly keyRenames: TextEdit[]
  formatOnly: boolean
}

const safeSegment = /^[\w-]+$/
const safeFlat = /^[\w.-]+$/

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i])
    i++
  return i
}

function nodeAt(tree: MessageTree, path: readonly string[]): MessageLeaf | MessageTree | undefined {
  let node: MessageLeaf | MessageTree | undefined = tree
  for (const segment of path) {
    if (node === undefined || isMessageLeaf(node))
      return undefined
    node = node[segment]
  }
  return node
}

/** True for flat files (`{ "a.b": "x" }`), false for nested ones, undefined when it cannot tell. */
function isFlatTree(tree: MessageTree, separator: string): boolean | undefined {
  const entries = Object.entries(tree)
  if (entries.length === 0)
    return undefined
  if (entries.some(([, value]) => !isMessageLeaf(value)))
    return false
  return entries.some(([key]) => key.includes(separator))
    ? true
    : undefined
}

/** The longest key prefix a tree shares with `path`. */
function longestPrefix(tree: MessageTree, prefix: readonly string[], path: readonly string[], separator: KeySeparator): number {
  let best = 0
  for (const [segment, child] of Object.entries(tree)) {
    const next = [
      ...prefix,
      ...splitKeyPath(segment, separator),
    ]
    best = Math.max(best, commonPrefix(next, path))
    if (!isMessageLeaf(child))
      best = Math.max(best, longestPrefix(child, next, path, separator))
  }
  return best
}

function mirrorPath(path: string, from: LocaleCode, to: LocaleCode): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return path.replace(new RegExp(`(^|[/._-])${escaped}(?=$|[/._-])`, 'g'), `$1${to}`)
}

function importEdit(text: string, lines: readonly string[]): TextEdit | undefined {
  const missing = lines.filter(line => !text.includes(line.trim()))
  if (missing.length === 0)
    return undefined
  // A `---` frontmatter holds the server code of a component; a later `<script>` runs in the browser.
  const open = /^\s*---\r?\n/.exec(text)
  const frontmatter = open && /^---\s*$/m.test(text.slice(open[0].length))
    ? open
    : undefined
  const script = frontmatter ?? /<script\b[^>]*>\r?\n?/.exec(text)
  let at = 0
  if (script) {
    at = script.index + script[0].length
  }
  else {
    const last = [
      ...text.matchAll(/^import\s.*$/gm),
    ].at(-1)
    if (last)
      at = last.index + last[0].length + 1
  }
  return {
    range: { start: at, end: at },
    text: `${missing.join('\n')}\n`,
  }
}

class PlanBuilder {
  readonly work = new Map<string, Work>()
  readonly created = new Map<string, Target>()
  /** New files that a finder's `resolveKey` gave one key. */
  readonly keyFiles = new Map<string, Target>()
  /** Resources that are the file of a key deleted from them: removed once empty. */
  readonly keyFilesLeft = new Set<string>()
  readonly sourceEdits = new Map<string, TextEdit[]>()
  readonly sourceImports = new Map<string, Set<string>>()
  readonly decisions: Decision[] = []
  readonly warnings: string[] = []
  readonly touched = new Set<KeyString>()
  readonly stateById: ReadonlyMap<string, ResourceState>
  readonly config: ResolvedConfig
  /** Source values set by this plan, for the source records of targets set after them. */
  readonly plannedSource = new Map<KeyString, MessageLeaf>()
  draft: ReviewDraft | undefined

  constructor(readonly options: PlannerOptions, readonly state: PlannerState, readonly answers: Answers) {
    this.config = options.config
    this.stateById = new Map(state.resources.map(s => [s.resource.id, s]))
  }

  /** ---- Targets ---- */
  targetOf(s: ResourceState): Target {
    const format = this.options.registry.formatById(s.resource.format)
    if (!format)
      throw errors.X18N2001({ path: s.resource.path })
    return {
      id: s.resource.id,
      path: s.resource.path,
      locale: s.resource.locale,
      namespace: s.resource.namespace,
      keySeparator: s.resource.keySeparator,
      format,
      state: s,
    }
  }

  workFor(target: Target): Work {
    let entry = this.work.get(target.id)
    if (!entry) {
      entry = {
        target,
        tree: target.state?.rawTree ?? {},
        ops: [],
        keyRenames: [],
        formatOnly: false,
      }
      this.work.set(target.id, entry)
    }
    return entry
  }

  writable(id: string): ResourceState {
    const s = this.stateById.get(id)!
    if (s.resource.readonly)
      throw errors.X18N4001({ path: s.resource.path })
    return s
  }

  keyId(key: KeyString): { namespace: string | undefined, path: string[] } {
    const id = splitKey(key, this.state.namespaced, this.config.keySeparator)
    return {
      namespace: id.namespace,
      path: [...id.path],
    }
  }

  separatorOf(target: { readonly keySeparator?: KeySeparator | undefined }): KeySeparator {
    return keySeparatorOf(target, this.config.keySeparator)
  }

  /**
   * Key path relative to a resource, or undefined when the key does not belong there.
   * A resource of literal keys (`keySeparator: false`) gets the whole rest of the key as one segment.
   */
  relativePath(key: KeyString, target: { readonly namespace: string | undefined, readonly keySeparator?: KeySeparator | undefined }): string[] | undefined {
    const { namespace, rest } = splitNamespace(key, this.state.namespaced)
    const literal = this.separatorOf(target) === false
    const joiner = keyJoiner(this.config.keySeparator)
    const split = (text: string): string[] => splitKeyPath(text, literal
      ? false
      : joiner)
    const fallback = this.config.namespace.default
    if (this.state.namespaced) {
      return (namespace ?? fallback) === (target.namespace ?? fallback)
        ? split(rest)
        : undefined
    }
    if (!target.namespace) {
      return rest === ''
        ? undefined
        : split(rest)
    }
    const prefix = target.namespace.split('.').join(joiner) + joiner
    if (rest.length <= prefix.length || !rest.startsWith(prefix))
      return undefined
    return split(rest.slice(prefix.length))
  }

  storedPathFor(entry: Work, relative: readonly string[]): string[] {
    const stored = this.options.toStored(entry.target, relative)
    const separator = this.separatorOf(entry.target)
    if (separator === false)
      return stored
    // Transforms (Rails, Chrome) fix the nesting; otherwise follow the file's style.
    const flat = stored.length === relative.length && (isFlatTree(entry.tree, separator) ?? (this.config.keyStyle === 'flat'))
    return flat
      ? [
          stored.join(separator),
        ]
      : stored
  }

  createTarget(key: KeyString, locale: LocaleCode): Target {
    const { resources, sourceLocale, namespaced } = this.state
    const fits = (s: ResourceState): boolean => this.relativePath(key, s.resource) !== undefined
    const source = this.options.message(key, sourceLocale)
    const sourceState = source && this.stateById.get(source.resource)
    // In prefix mode the namespace is the one of the source file holding the key (`lang/en/messages.php`).
    const namespace = namespaced
      ? this.keyId(key).namespace ?? this.config.namespace.default
      : sourceState?.resource.namespace
    const exists = (path: string): boolean => resources.some(r => r.resource.path === path)
    // Next to a resource of the key's namespace in another locale, else next to one of another namespace in this locale.
    const sibling = (r: ResourceState): boolean => r.resource.locale === locale && r.resource.namespace !== undefined && namespace !== undefined
    const model = (sourceState && fits(sourceState)
      ? sourceState
      : undefined)
    ?? resources.find(s => s.resource.locale === sourceLocale && fits(s)) ?? resources.find(fits) ?? resources.find(sibling)
    const resolved = this.options.resolveNew(locale, namespace, model?.resource)
    if (resolved && !exists(resolved)) {
      const format = this.options.registry.formatFor(resolved)
      if (format?.serialize) {
        const target: Target = {
          id: resolved,
          path: resolved,
          locale,
          namespace,
          keySeparator: model?.resource.keySeparator,
          format,
          state: undefined,
        }
        this.created.set(resolved, target)
        return target
      }
    }
    const format = model && this.options.registry.formatById(model.resource.format)
    let path = model && mirrorPath(model.resource.path, model.resource.locale, locale)
    if (model && path && namespace !== undefined && model.resource.namespace !== undefined && model.resource.namespace !== namespace)
      path = mirrorPath(path, model.resource.namespace, namespace)
    if (!model || !format?.serialize || model.resource.block || !path || exists(path))
      throw errors.X18N4005({ key, locale })
    const target: Target = {
      id: path,
      path,
      locale,
      namespace: namespace ?? model.resource.namespace,
      keySeparator: model.resource.keySeparator,
      format,
      state: undefined,
    }
    this.created.set(path, target)
    return target
  }

  /** The file a locale finder gives the key, created when it does not exist. */
  keyTarget(key: KeyString, locale: LocaleCode): Target | undefined {
    const file = this.options.resolveKey(key, locale)
    if (!file)
      return undefined
    const existing = this.state.resources.find(s => s.resource.path === file.path && !s.resource.block)
    if (existing) {
      if (existing.resource.locale !== locale || this.relativePath(key, existing.resource) === undefined)
        throw errors.X18N4005({ key, locale })
      return this.targetOf(existing)
    }
    const pending = this.keyFiles.get(file.path)
    if (pending)
      return pending
    const format = file.format === undefined
      ? this.options.registry.formatFor(file.path)
      : this.options.registry.formatById(file.format)
    if (!format?.serialize)
      throw errors.X18N4005({ key, locale })
    const target: Target = {
      id: file.path,
      path: file.path,
      locale,
      namespace: this.state.namespaced
        ? this.keyId(key).namespace ?? this.config.namespace.default
        : undefined,
      format,
      state: undefined,
    }
    this.keyFiles.set(file.path, target)
    return target
  }

  /** Placement: the key's own file, then the namespace's resource, then the longest shared prefix, then the first; a tie is a decision. */
  pickTarget(key: KeyString, locale: LocaleCode): Target {
    const own = this.keyTarget(key, locale)
    if (own)
      return own
    let inLocale = this.state.resources.filter(s => s.resource.locale === locale && this.relativePath(key, s.resource) !== undefined)
    // When the source locale keeps the key in a namespace file (`lang/en/messages.php`), mirror that file
    // instead of using a file without the namespace (`lang/de.json`).
    const source = this.options.message(key, this.state.sourceLocale)
    const sourceNamespace = source && this.stateById.get(source.resource)?.resource.namespace
    if (sourceNamespace !== undefined && !this.state.namespaced)
      inLocale = inLocale.filter(s => s.resource.namespace === sourceNamespace)
    if (inLocale.length === 0) {
      const pending = [
        ...this.created.values(),
      ].find(t => t.locale === locale && this.relativePath(key, t) !== undefined)
      return pending ?? this.createTarget(key, locale)
    }
    if (inLocale.length === 1)
      return this.targetOf(inLocale[0]!)
    const path = this.keyId(key).path
    const scores = inLocale.map((s) => {
      const prefix = s.resource.namespace && !this.state.namespaced
        ? path.slice(0, s.resource.namespace.split('.').length)
        : []
      return {
        s,
        best: longestPrefix(s.tree, prefix, path, this.separatorOf(s.resource)),
      }
    })
    const top = Math.max(...scores.map(x => x.best))
    const winners = scores.filter(x => x.best === top)
    if (winners.length === 1 || top === 0)
      return this.targetOf(winners[0]!.s)
    const id = `target:${key}:${locale}`
    this.decisions.push({
      id,
      message: `Which file gets "${key}" in ${locale}?`,
      options: winners.map(w => ({ id: w.s.resource.id, label: w.s.resource.id })),
      default: winners[0]!.s.resource.id,
    })
    return this.targetOf((winners.find(w => w.s.resource.id === this.answers[id]) ?? winners[0]!).s)
  }

  /** ---- Message ops ---- */
  pushOp(entry: Work, op: MessageOp): void {
    entry.ops.push(op)
    entry.tree = applyMessageOps(entry.tree, [op])
  }

  /** False when `replace` is false and the value would replace other keys or a message on its path: the set is skipped with a warning. */
  setValue(key: KeyString, locale: LocaleCode, value: MessageLeaf, replace = true): boolean {
    const existing = this.options.message(key, locale)
    if (existing) {
      this.touched.add(key)
      this.pushOp(this.workFor(this.targetOf(this.writable(existing.resource))), { type: 'set', path: existing.storedPath, value })
      return true
    }
    const target = this.pickTarget(key, locale)
    if (target.state)
      this.writable(target.state.resource.id)
    const entry = this.workFor(target)
    const stored = this.storedPathFor(entry, this.relativePath(key, target)!)
    const occupied = nodeAt(entry.tree, stored)
    const parent = occupied !== undefined && !isMessageLeaf(occupied)
    if (!replace) {
      const leaf = stored.slice(0, -1).findIndex((_, i) => {
        const node = nodeAt(entry.tree, stored.slice(0, i + 1))
        return node !== undefined && isMessageLeaf(node)
      })
      if (leaf !== -1) {
        const message = stored.slice(0, leaf + 1).join(keyJoiner(this.separatorOf(target)))
        this.warnings.push(`"${key}" is not added: "${message}" is a message in ${target.path}, and adding "${key}" would replace it.`)
        return false
      }
      if (parent) {
        this.warnings.push(`"${key}" is not added: it is a parent of other keys in ${target.path}, and adding it would replace them.`)
        return false
      }
    }
    else if (parent) {
      this.warnings.push(`"${key}" is a parent of other keys in ${target.path}; they are replaced.`)
    }
    this.touched.add(key)
    this.pushOp(entry, { type: 'set', path: stored, value })
    return true
  }

  deleteMessage(m: Message): void {
    const s = this.writable(m.resource)
    if (!s.resource.block && this.options.resolveKey(m.key, m.locale)?.path === s.resource.path)
      this.keyFilesLeft.add(s.resource.id)
    const entry = this.workFor(this.targetOf(s))
    // Delete the highest ancestor left empty, so formats that drop one property leave no `{}`.
    let path = [...m.storedPath]
    while (path.length > 1) {
      const parent = nodeAt(entry.tree, path.slice(0, -1))
      if (parent === undefined || isMessageLeaf(parent) || Object.keys(parent).length > 1)
        break
      path = path.slice(0, -1)
    }
    this.pushOp(entry, { type: 'delete', path })
  }

  /** Renames a key in every locale, in place when only the last segment changes. */
  /**
   * Renames a parent object in place where only its last segment changes, so the subtree keeps its
   * position and layout. Returns the resources it handled.
   */
  renameNode(from: KeyString, to: KeyString): Set<string> {
    const handled = new Set<string>()
    for (const s of this.state.resources) {
      const relativeFrom = this.relativePath(from, s.resource)
      const relativeTo = this.relativePath(to, s.resource)
      if (!relativeFrom || !relativeTo || s.resource.readonly || !this.options.registry.formatById(s.resource.format)?.edit)
        continue
      const stored = s.toStored(relativeFrom)
      const next = s.toStored(relativeTo)
      const node = nodeAt(s.rawTree, stored)
      const range = s.ranges.get(pathId(stored))
      const last = next.at(-1)!
      const sameParent = next.length === stored.length && next.slice(0, -1).every((segment, i) => segment === stored[i])
      if (node === undefined || isMessageLeaf(node) || !range || !sameParent || !safeSegment.test(last))
        continue
      const entry = this.workFor(this.targetOf(s))
      entry.keyRenames.push({
        range: { start: range.key.start + s.offset, end: range.key.end + s.offset },
        text: last,
      })
      const leaves = [
        ...walkLeaves(node, stored),
      ]
      entry.tree = applyMessageOps(entry.tree, [
        ...leaves.map(leaf => ({ type: 'delete' as const, path: leaf.path })),
        ...leaves.map(leaf => ({
          type: 'set' as const,
          path: [
            ...next,
            ...leaf.path.slice(stored.length),
          ],
          value: leaf.value,
        })),
      ])
      handled.add(s.resource.id)
    }
    return handled
  }

  moveKey(from: KeyString, to: KeyString, renamed: ReadonlySet<string> = new Set()): void {
    this.touched.add(from)
    this.touched.add(to)
    for (const [locale, list] of this.options.messages(from) ?? []) {
      const m = list[0]!
      if (renamed.has(m.resource))
        continue
      const s = this.writable(m.resource)
      const relative = this.relativePath(to, s.resource)
      const own = this.options.resolveKey(to, locale)
      if (!relative || (own && own.path !== s.resource.path)) {
        this.deleteMessage(m)
        this.setValue(to, locale, m.value)
        continue
      }
      const entry = this.workFor(this.targetOf(s))
      const separator = this.separatorOf(s.resource)
      const flat = separator !== false && m.storedPath.length === 1 && m.storedPath[0]!.includes(separator)
      const next = flat
        ? [
            relative.join(separator),
          ]
        : this.options.toStored(s.resource, relative)
      const sameParent = next.length === m.storedPath.length && next.slice(0, -1).every((segment, i) => segment === m.storedPath[i])
      const last = next.at(-1)!
      if (sameParent && m.range && (flat ? safeFlat : safeSegment).test(last)) {
        entry.keyRenames.push({ range: m.range.key, text: last })
        entry.tree = applyMessageOps(entry.tree, [
          { type: 'delete', path: m.storedPath },
          { type: 'set', path: next, value: m.value },
        ])
        continue
      }
      this.deleteMessage(m)
      this.pushOp(entry, {
        type: 'set',
        path: this.storedPathFor(entry, relative),
        value: m.value,
      })
    }
  }

  // ---- Usages ----

  /** The raw text a usage needs to refer to `next`, given its scope. */
  rawFor(usage: Usage, next: KeyString): string | undefined {
    // A relative key (Rails `t('.title')`) stays relative when the new key keeps its scope.
    if (usage.raw.startsWith('.') && usage.key?.endsWith(usage.raw)) {
      const scope = usage.key.slice(0, usage.key.length - usage.raw.length)
      if (next.startsWith(`${scope}.`))
        return next.slice(scope.length)
    }
    const { namespace, rest: text } = splitNamespace(next, this.state.namespaced)
    let rest = text
    const separator = this.config.namespace.separator
    const explicit = this.state.namespaced && separator !== false && usage.raw.indexOf(separator) > 0
    if (usage.scopePrefix && !explicit) {
      const prefix = usage.scopePrefix + keyJoiner(this.config.keySeparator)
      if (!rest.startsWith(prefix))
        return undefined
      rest = rest.slice(prefix.length)
    }
    if (!this.state.namespaced)
      return rest
    if (explicit || namespace !== (usage.scopeNamespace ?? this.config.namespace.default)) {
      // Without a separator in code, a key of another namespace cannot be written.
      return separator === false
        ? undefined
        : `${namespace}${separator}${rest}`
    }
    return rest
  }

  editSource(path: string, edit: TextEdit): void {
    const list = this.sourceEdits.get(path) ?? []
    this.sourceEdits.set(path, list)
    if (!list.some(e => e.range.start === edit.range.start && e.range.end === edit.range.end))
      list.push(edit)
  }

  rewriteUsages(from: KeyString, to: KeyString): void {
    for (const { usage, possible } of this.options.usageMatches({ key: from })) {
      if (possible || usage.key !== from)
        continue
      const raw = this.rawFor(usage, to)
      if (raw === undefined)
        this.warnings.push(`${usage.path}: usage of "${from}" is under the key prefix "${usage.scopePrefix}" and was not updated.`)
      else
        this.editSource(usage.path, { range: usage.range, text: raw })
    }
  }

  /** Rewrites the static part of prefix usages under `from`, and warns about the ones it cannot follow. */
  rewritePrefixUsages(from: KeyString, to: KeyString): void {
    for (const { usage, possible } of this.options.usageMatches({ prefix: from })) {
      if (!possible || usage.key === undefined)
        continue
      const raw = usage.key.startsWith(from)
        ? this.rawFor(usage, to + usage.key.slice(from.length))
        : undefined
      if (raw === undefined)
        this.warnings.push(`${usage.path}: dynamic usage "${usage.raw}" may refer to renamed keys and was not updated.`)
      else
        this.editSource(usage.path, { range: usage.range, text: raw })
    }
  }

  /** ---- Ops ---- */
  conflictCheck(to: KeyString): void {
    const existing = this.options.messages(to)
    if (!existing && !this.options.parents().has(to))
      return
    const files = [
      ...new Set([
        ...existing?.values() ?? [],
      ].flatMap(list => list.map(m => this.stateById.get(m.resource)?.resource.path ?? m.resource))),
    ]
    throw errors.X18N4002({ key: to, files })
  }

  rename(op: Extract<EditOp, { type: 'rename' | 'rename-prefix' }>): void {
    if (op.from === op.to)
      return
    const all = this.options.allKeys()
    const isLeaf = this.options.messages(op.from) !== undefined
    const under = all.filter(key => isKeyUnder(key, op.from, this.config.keySeparator))
    // Derived keys (`item_one`) move with their base key (`item`).
    const derived = all.filter(key => this.options.basesOf(key).includes(op.from))
    let keys: KeyString[]
    if (op.type === 'rename-prefix') {
      keys = under
    }
    else if (isLeaf) {
      keys = [op.from, ...derived]
    }
    else {
      keys = under.length > 0
        ? under
        : derived
    }
    if (keys.length === 0)
      throw errors.X18N4006({ key: op.from })
    const pairs = keys.map(key => [
      key,
      replaceKeyPrefix(key, op.from, op.to),
    ] as const)
    for (const [, to] of pairs)
      this.conflictCheck(to)
    const renamed = keys.includes(op.from)
      ? new Set<string>()
      : this.renameNode(op.from, op.to)
    for (const [from, to] of pairs) {
      this.moveKey(from, to, renamed)
      this.reviewDraft()?.move(from, to)
      if (op.usages !== false)
        this.rewriteUsages(from, to)
    }
    if (op.usages === false)
      return
    if (!keys.includes(op.from))
      this.rewriteUsages(op.from, op.to)
    this.rewritePrefixUsages(op.from, op.to)
  }

  delete(op: Extract<EditOp, { type: 'delete' }>): void {
    const keys = this.options.messages(op.key)
      ? [op.key]
      : this.options.allKeys().filter(key => isKeyUnder(key, op.key, this.config.keySeparator))
    if (keys.length === 0)
      throw errors.X18N4006({ key: op.key })
    for (const key of keys) {
      this.touched.add(key)
      this.reviewDraft()?.remove(key, op.locales ?? 'all')
      for (const [locale, list] of this.options.messages(key) ?? []) {
        if (op.locales === undefined || op.locales === 'all' || op.locales.includes(locale))
          list.forEach(m => this.deleteMessage(m))
      }
      const used = this.options.usageMatches({ key }).filter(match => !match.possible).length
      if (used > 0) {
        this.warnings.push(`"${key}" still has ${used} usage${used === 1
          ? ''
          : 's'}.`)
      }
    }
  }

  extract(items: readonly ExtractItem[]): void {
    for (const item of items) {
      if (!this.options.message(item.key, this.state.sourceLocale))
        this.setValue(item.key, this.state.sourceLocale, item.value)
      this.editSource(item.path, { range: item.range, text: item.replacement })
      if (item.imports?.length) {
        const set = this.sourceImports.get(item.path) ?? new Set()
        this.sourceImports.set(item.path, set)
        item.imports.forEach(line => set.add(line))
      }
    }
  }

  // ---- Reviews ----

  /** The review draft, or undefined when reviews are off. */
  reviewDraft(): ReviewDraft | undefined {
    const reviews = this.state.reviews
    if (reviews)
      this.draft ??= new ReviewDraft(reviews.data)
    return this.draft
  }

  requireReviews(): ReviewDraft {
    const draft = this.reviewDraft()
    if (!draft)
      throw errors.X18N5003({ reason: this.state.reviewProblem ?? 'reviews are off' })
    return draft
  }

  /** Records the source value a target was written against, once the project keeps a review file. */
  recordSource(key: KeyString, locale: LocaleCode, force = false): void {
    if (locale === this.state.sourceLocale || (!force && this.state.reviews?.text === undefined))
      return
    const source = this.plannedSource.has(key)
      ? this.plannedSource.get(key)
      : this.options.message(key, this.state.sourceLocale)?.value
    if (source !== undefined)
      this.reviewDraft()?.record(key, locale, sourceHash(source))
  }

  review(op: Extract<EditOp, { type: 'review' }>): void {
    const draft = this.requireReviews()
    if (!this.options.messages(op.key))
      throw errors.X18N4006({ key: op.key })
    if (!this.state.locales.includes(op.locale))
      throw errors.X18N4008({ reason: `unknown locale "${op.locale}"` })
    if (op.review === 'suggestion' && op.suggestion === undefined)
      throw errors.X18N4008({ reason: 'a suggestion needs a value' })
    const current = this.options.message(op.key, op.locale)?.value
    this.touched.add(op.key)
    draft.add(op.key, op.locale, {
      id: op.id!, // filled in by `plan`
      type: op.review,
      ...op.author && { author: op.author },
      time: op.time!,
      ...op.text !== undefined && { text: op.text },
      ...op.review === 'suggestion' && { suggestion: op.suggestion },
      ...op.review === 'approve' && current !== undefined && {
        value: valueText(current),
      },
    })
  }

  applySuggestion(id: string): void {
    const draft = this.requireReviews()
    const found = findReview(draft.data, id)
    if (!found)
      throw errors.X18N5004({ id })
    const { key, locale, comment } = found
    if (comment.type !== 'suggestion' || comment.suggestion === undefined || comment.resolved)
      throw errors.X18N5005({ id })
    this.setValue(key, locale, comment.suggestion)
    this.recordSource(key, locale, true)
    draft.resolve(id)
  }

  resolveReview(id: string): void {
    const draft = this.requireReviews()
    const found = findReview(draft.data, id)
    if (!found)
      throw errors.X18N5004({ id })
    this.touched.add(found.key)
    draft.resolve(id)
  }

  markFresh(op: Extract<EditOp, { type: 'mark-fresh' }>): void {
    this.requireReviews()
    if (this.options.message(op.key, this.state.sourceLocale) === undefined)
      throw errors.X18N4006({ key: op.key })
    const locales = op.locales ?? this.state.locales.filter(locale => this.options.message(op.key, locale) !== undefined)
    this.touched.add(op.key)
    for (const locale of locales)
      this.recordSource(op.key, locale, true)
  }

  set(op: Extract<EditOp, { type: 'set' }>): void {
    const replace = op.replace !== false
    if (!this.setValue(op.key, op.locale, op.value, replace))
      return
    if (op.locale === this.state.sourceLocale)
      this.plannedSource.set(op.key, op.value)
    else if (op.value !== '')
      this.recordSource(op.key, op.locale)
    if (!this.config.write.keepFilled)
      return
    for (const locale of this.state.locales) {
      if (locale !== op.locale && !this.state.fallbacks[locale] && !this.options.message(op.key, locale))
        this.setValue(op.key, locale, '', replace)
    }
  }

  run(ops: readonly EditOp[]): void {
    for (const op of ops) {
      switch (op.type) {
        case 'set':
          this.set(op)
          break
        case 'delete':
          this.delete(op)
          break
        case 'rename':
        case 'rename-prefix':
          this.rename(op)
          break
        case 'extract':
          this.extract(op.items)
          break
        case 'format':
          for (const s of this.state.resources) {
            if ((!op.paths || op.paths.includes(s.resource.path)) && !s.resource.readonly && !s.error)
              this.workFor(this.targetOf(s)).formatOnly = true
          }
          break
        case 'review':
          this.review(op)
          break
        case 'resolve-review':
          this.resolveReview(op.id)
          break
        case 'apply-suggestion':
          this.applySuggestion(op.id)
          break
        case 'mark-fresh':
          this.markFresh(op)
          break
      }
    }
  }

  /** ---- Changes ---- */
  compare(): (a: string, b: string) => number {
    return this.config.write.sort === 'locale'
      ? (a, b) => a.localeCompare(b)
      : (a, b) => (a < b
          ? -1
          : a > b
            ? 1
            : 0)
  }

  /** The new content of one existing resource. */
  nextContent(entry: Work, s: ResourceState): string {
    const { target } = entry
    const ctx = {
      path: target.path,
      locale: target.locale,
      namespace: target.namespace,
      indent: this.config.write.indent,
    }
    const sort = this.config.write.sort !== false
    const edit = target.format.edit
    if (entry.formatOnly || sort || !edit) {
      if (!target.format.serialize)
        throw errors.X18N4001({ path: target.path })
      if (!entry.formatOnly && !edit)
        this.warnings.push(`${target.path} was re-written in full (the ${target.format.id} format cannot edit in place); formatting was reset.`)
      return target.format.serialize(sort || entry.formatOnly
        ? sortTree(entry.tree, sort
            ? this.compare()
            : () => 0)
        : entry.tree, ctx)
    }
    const local = (e: TextEdit): TextEdit => ({
      range: { start: e.range.start - s.offset, end: e.range.end - s.offset },
      text: e.text,
    })
    if (entry.ops.length === 0)
      return applyTextEdits(s.content, entry.keyRenames.map(local))
    // Key renames mixed with other ops become delete + set, so one edit pass sees consistent offsets.
    const renameOps: MessageOp[] = []
    for (const rename of entry.keyRenames) {
      const node = [...s.ranges].find(([, range]) => range.key.start + s.offset === rename.range.start)
      if (!node)
        continue
      const oldPath = node[0].split('\u0000')
      const newPath = [
        ...oldPath.slice(0, -1),
        rename.text,
      ]
      const value = nodeAt(entry.tree, newPath)
      renameOps.push({ type: 'delete', path: oldPath })
      if (value !== undefined && isMessageLeaf(value)) {
        renameOps.push({ type: 'set', path: newPath, value })
      }
      else if (value !== undefined) {
        renameOps.push(...[
          ...walkLeaves(value, newPath),
        ].map(leaf => ({ type: 'set' as const, path: leaf.path, value: leaf.value })))
      }
    }
    return applyTextEdits(s.content, edit(s.content, [
      ...renameOps,
      ...entry.ops,
    ], ctx))
  }

  changes(): { changes: FileChange[], texts: Map<string, string | undefined> } {
    const changes: FileChange[] = []
    const texts = new Map<string, string | undefined>()
    const resourceEdits = new Map<string, TextEdit[]>()
    for (const entry of this.work.values()) {
      const { target } = entry
      const s = target.state
      if (!s) {
        const ctx = {
          path: target.path,
          locale: target.locale,
          namespace: target.namespace,
          indent: this.config.write.indent,
        }
        const tree = this.config.write.sort === false
          ? entry.tree
          : sortTree(entry.tree, this.compare())
        changes.push({
          type: 'create',
          path: target.path,
          content: target.format.serialize!(tree, ctx),
        })
        texts.set(target.path, undefined)
        continue
      }
      if (this.keyFilesLeft.has(s.resource.id) && Object.keys(entry.tree).length === 0) {
        changes.push({ type: 'delete', path: target.path })
        texts.set(target.path, this.state.fileTexts.get(target.path))
        continue
      }
      const edits = diffText(s.content, this.nextContent(entry, s))
        .map(e => ({
          range: { start: e.range.start + s.offset, end: e.range.end + s.offset },
          text: e.text,
        }))
      if (edits.length === 0)
        continue
      const list = resourceEdits.get(target.path) ?? []
      resourceEdits.set(target.path, list)
      list.push(...edits)
    }
    for (const [path, edits] of resourceEdits) {
      changes.push({ type: 'edit', path, edits })
      texts.set(path, this.state.fileTexts.get(path))
    }
    for (const [path, edits] of this.sourceEdits) {
      const text = this.options.text(path)
      const imports = this.sourceImports.get(path)
      const extra = imports && text !== undefined
        ? importEdit(text, [...imports])
        : undefined
      changes.push({
        type: 'edit',
        path,
        edits: [
          ...edits,
          ...extra
            ? [extra]
            : [],
        ].sort((a, b) => a.range.start - b.range.start),
      })
      texts.set(path, text)
    }
    const review = this.reviewChange()
    if (review) {
      changes.push(review)
      texts.set(review.path, this.state.reviews?.text)
    }
    return { changes, texts }
  }

  reviewChange(): FileChange | undefined {
    const reviews = this.state.reviews
    if (!reviews || !this.draft?.changed)
      return undefined
    const next = reviews.store.serialize(sortReviews(this.draft.data))
    if (reviews.text === undefined)
      return { type: 'create', path: reviews.file, content: next }
    return next === reviews.text
      ? undefined
      : {
          type: 'edit',
          path: reviews.file,
          edits: diffText(reviews.text, next),
        }
  }
}

export interface Planner {
  readonly plan: (ops: readonly EditOp[], answers?: Answers) => Plan
  readonly apply: (plan: Plan, answers: Answers) => Promise<ApplyResult>
}

export function createPlanner(options: PlannerOptions): Planner {
  const texts = new Map<string, ReadonlyMap<string, string | undefined>>()

  /** Gives new reviews an id and a time, so planning again (after decisions) writes the same comments. */
  function withReviewIds(ops: readonly EditOp[], data: ReviewData): readonly EditOp[] {
    const used = new Set<string>()
    const time = new Date().toISOString()
    return ops.map((op) => {
      if (op.type !== 'review' || (op.id !== undefined && op.time !== undefined))
        return op
      const id = op.id ?? reviewId(id => used.has(id) || findReview(data, id) !== undefined)
      used.add(id)
      return { ...op, id, time: op.time ?? time }
    })
  }

  function planWith(input: readonly EditOp[], answers: Answers): { plan: Plan, texts: ReadonlyMap<string, string | undefined> } {
    const state = options.state()
    const ops = withReviewIds(input, state.reviews?.data ?? noReviews)
    const builder = new PlanBuilder(options, state, answers)
    builder.run(ops)
    const result = builder.changes()
    const id = hashText(JSON.stringify({ revision: state.revision, ops, answers }))
    return {
      plan: {
        id,
        revision: state.revision,
        ops,
        changes: result.changes,
        decisions: builder.decisions,
        warnings: builder.warnings,
        keys: [...builder.touched].sort(),
      },
      texts: result.texts,
    }
  }

  async function write(change: FileChange): Promise<FileEvent> {
    if (change.type === 'edit') {
      const current = await options.host.readFile(change.path)
      await options.host.writeFile(change.path, applyTextEdits(current ?? '', change.edits))
      return { type: 'change', path: change.path }
    }
    if (change.type === 'create') {
      await options.host.writeFile(change.path, change.content)
      return { type: 'create', path: change.path }
    }
    await options.host.deleteFile(change.path)
    return { type: 'delete', path: change.path }
  }

  return {
    plan(ops, answers = {}) {
      const result = planWith(ops, answers)
      texts.set(result.plan.id, result.texts)
      return result.plan
    },
    async apply(plan, answers) {
      const unanswered = plan.decisions.filter(d => answers[d.id] === undefined)
      if (unanswered.length > 0) {
        throw errors.X18N4003({
          decisions: unanswered.map(d => d.message),
        })
      }
      if (plan.revision !== options.state().revision)
        throw errors.X18N4004()
      const fresh = plan.decisions.length > 0
        ? planWith(plan.ops, answers)
        : { plan, texts: texts.get(plan.id) ?? new Map() }
      for (const change of fresh.plan.changes) {
        const current = await options.host.readFile(change.path)
        const expected = fresh.texts.get(change.path)
        if ((change.type !== 'create' && expected !== undefined && current !== expected) || (change.type === 'create' && current !== undefined))
          throw errors.X18N4004({ path: change.path })
      }
      const events: FileEvent[] = []
      for (const change of fresh.plan.changes)
        events.push(await write(change))
      texts.delete(plan.id)
      const result = await options.update(events)
      return { revision: result?.revision ?? options.state().revision, changes: fresh.plan.changes }
    },
  }
}
