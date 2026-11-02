import type { ExtractCandidate } from '@x18n/builtins/extractors'
import type { EditOp, ErrorInfo, FileChange, KeyString, MessageChange, OverlayHost, Plan, Project, ResourceNode, ReviewType, TextRange, Diagnostic as X18nDiagnostic } from '@x18n/core'
import type { NodeHost } from '@x18n/node'
import type {
  CodeAction,
  CodeLens,
  CompletionItem,
  Connection,
  Diagnostic,
  DocumentSymbol,
  Hover,
  InitializeParams,
  InitializeResult,
  InlayHint,
  Location,
  Range,
  SymbolInformation,
  TextDocumentPositionParams,
  WorkspaceEdit,
} from 'vscode-languageserver'
import type * as P from './protocol'
import type { UiServers } from './ui'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractItems, findCandidates } from '@x18n/builtins/extractors'
import { createLineIndex, createOverlayHost, isX18nError, joinKey, renderExplanation, renderPrompt, splitKey, toErrorInfo } from '@x18n/core'
import { loadWorkspace, migrateI18nAlly } from '@x18n/node'
import {
  CodeActionKind,
  CompletionItemKind,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  FileChangeType,
  ResponseError,
  SymbolKind,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { version } from '../package.json' with { type: 'json' }
import { commands, methods } from './protocol'

export interface ServerProject {
  readonly name: string
  /** Absolute root. */
  readonly root: string
  readonly project: Project
  readonly overlay: OverlayHost
  /** Absolute path of the config file, when there is one. */
  readonly configFile?: string | undefined
}

export interface ServerOptions {
  /** Loads the projects of a workspace folder. Default: `@x18n/node` with an overlay host. */
  readonly loadProjects?: ((folder: string, wrapHost: (host: NodeHost) => OverlayHost) => Promise<readonly Omit<ServerProject, 'overlay'>[]>) | undefined
  /** Starts the UI server for a project (`x18n/openUi`). */
  readonly openUi?: ((project: ServerProject) => Promise<P.OpenUiResult>) | undefined
}

interface Settings {
  annotationMaxLength: number
  displayLocale: string | undefined
  codeLens: boolean
  /** Flag emoji next to locales in hovers. */
  showFlags: boolean
}

const reviewTypes: readonly ReviewType[] = [
  'comment',
  'approve',
  'request-change',
  'suggestion',
]

const severities: Record<X18nDiagnostic['severity'], DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
}

function truncate(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max - 1)}…`
    : text
}

function display(value: unknown): string | undefined {
  return value === undefined
    ? undefined
    : typeof value === 'string'
      ? value
      : JSON.stringify(value)
}

const timeUnits = [
  ['year', 31_536e6],
  ['month', 2_592e6],
  ['week', 6_048e5],
  ['day', 864e5],
  ['hour', 36e5],
  ['minute', 6e4],
] as const

function changedAt(change: MessageChange): string {
  if (!Number.isFinite(change.updatedAt))
    return 'changed locally'
  const diff = change.updatedAt - Date.now()
  const [unit, size] = timeUnits.find(([, size]) => Math.abs(diff) >= size) ?? ['minute', 6e4]
  const when = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(diff / size), unit)
  return [
    when,
    change.revision?.slice(0, 7),
    change.author,
  ].filter(Boolean).join(' · ')
}

function posix(path: string): string {
  return sep === '\\'
    ? path.replace(/\\/g, '/')
    : path
}

class Server {
  readonly documents = new TextDocuments(TextDocument)
  readonly projects: ServerProject[] = []
  /** Workspace folders whose projects could not be loaded. */
  readonly failures: { readonly folder: string, readonly error: ErrorInfo }[] = []
  readonly published = new Map<string, Set<string>>()
  readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly settings: Settings = {
    annotationMaxLength: 40,
    displayLocale: undefined,
    codeLens: false,
    showFlags: true,
  }

  ready: Promise<void> = Promise.resolve()
  folders: string[] = []
  watchRegistration = false

  constructor(readonly connection: Connection, readonly options: ServerOptions) {}

  /** ---- Paths and positions ---- */
  locate(uri: string): { entry: ServerProject, path: string } | undefined {
    if (!uri.startsWith('file:'))
      return undefined
    const file = fileURLToPath(uri)
    let best: ServerProject | undefined
    for (const entry of this.projects) {
      const rel = relative(entry.root, file)
      if (!rel.startsWith('..') && !resolve(entry.root, rel).startsWith('..') && (!best || entry.root.length > best.root.length))
        best = entry
    }
    return best
      ? {
          entry: best,
          path: posix(relative(best.root, file)),
        }
      : undefined
  }

  uriOf(entry: ServerProject, path: string): string {
    return pathToFileURL(resolve(entry.root, path)).href
  }

  text(entry: ServerProject, path: string): string {
    return this.documents.get(this.uriOf(entry, path))?.getText() ?? entry.project.text(path) ?? ''
  }

  range(entry: ServerProject, path: string, range: TextRange): Range {
    const index = createLineIndex(this.text(entry, path))
    return {
      start: index.position(range.start),
      end: index.position(range.end),
    }
  }

  offset(uri: string, position: P.Position, entry: ServerProject, path: string): number {
    const document = this.documents.get(uri)
    return document
      ? document.offsetAt(position)
      : createLineIndex(this.text(entry, path)).offset(position)
  }

  location(entry: ServerProject, path: string, range: TextRange): Location {
    return {
      uri: this.uriOf(entry, path),
      range: this.range(entry, path, range),
    }
  }

  at(params: TextDocumentPositionParams): { entry: ServerProject, path: string, offset: number } | undefined {
    const found = this.locate(params.textDocument.uri)
    if (!found)
      return undefined
    return {
      ...found,
      offset: this.offset(params.textDocument.uri, params.position, found.entry, found.path),
    }
  }

  displayLocale(entry: ServerProject): string {
    const wanted = this.settings.displayLocale
    return wanted && entry.project.locales.includes(wanted)
      ? wanted
      : entry.project.sourceLocale
  }

  resourcePath(entry: ServerProject, id: string): string {
    return entry.project.resources.find(r => r.id === id)?.path ?? id
  }

  /** ---- Lifecycle ---- */
  async load(): Promise<void> {
    for (const folder of this.folders) {
      const overlays: OverlayHost[] = []
      const wrap = (host: NodeHost): OverlayHost => {
        const overlay = createOverlayHost(host)
        overlays.push(overlay)
        return overlay
      }
      const loaded = await (this.options.loadProjects
        ? this.options.loadProjects(folder, wrap)
        : loadWorkspace({ cwd: folder, wrapHost: wrap }).then(workspace => workspace.projects)).catch((error: unknown) => {
        const info = toErrorInfo(error)
        this.failures.push({ folder, error: info })
        void this.connection.window.showWarningMessage(`x18n: ${info.why}`)
        return []
      })
      loaded.forEach((item, i) => {
        const overlay = overlays[i]
        if (overlay && !this.projects.some(p => p.root === item.root)) {
          this.projects.push({
            name: item.name,
            root: item.root,
            project: item.project,
            overlay,
            configFile: item.configFile,
          })
        }
      })
    }
    // Editors show the server log, so a workspace without locale files explains itself as `x18n doctor` would.
    if (this.projects.every(entry => entry.project.resources.length === 0))
      this.connection.console.info(`No locale files found in the workspace.\n\n${this.explain()}`)
    for (const entry of this.projects) {
      entry.project.onChange((change) => {
        void this.connection.sendNotification(methods.changed, { project: entry.name, revision: change.revision, keys: change.keys } satisfies P.ChangedParams)
        this.publishDiagnostics()
      })
      void entry.project.loadHistory({ watch: true })
    }
  }

  async initialize(params: InitializeParams): Promise<InitializeResult> {
    const folders = params.workspaceFolders?.map(folder => fileURLToPath(folder.uri)) ?? []
    if (folders.length === 0 && params.rootUri)
      folders.push(fileURLToPath(params.rootUri))
    this.folders = folders
    this.watchRegistration = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true
    const settings = params.initializationOptions as Partial<Settings> | undefined // free-form client data; read field by field
    if (typeof settings?.displayLocale === 'string')
      this.settings.displayLocale = settings.displayLocale
    if (typeof settings?.annotationMaxLength === 'number')
      this.settings.annotationMaxLength = settings.annotationMaxLength
    if (typeof settings?.codeLens === 'boolean')
      this.settings.codeLens = settings.codeLens
    if (typeof settings?.showFlags === 'boolean')
      this.settings.showFlags = settings.showFlags
    return {
      serverInfo: { name: 'x18n', version },
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        definitionProvider: true,
        implementationProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        hoverProvider: true,
        inlayHintProvider: true,
        completionProvider: {
          triggerCharacters: ['.', '\'', '"', '`', ':'],
        },
        codeActionProvider: {
          codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorExtract],
        },
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        codeLensProvider: { resolveProvider: false },
        executeCommandProvider: {
          commands: Object.values(commands),
        },
      },
    }
  }

  async initialized(): Promise<void> {
    const progress = await this.connection.window.createWorkDoneProgress().catch(() => undefined)
    progress?.begin('x18n', 0, 'Indexing keys and usages', false)
    this.ready = this.load().finally(() => progress?.done())
    await this.ready
    this.publishDiagnostics()
    if (this.watchRegistration) {
      void this.connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: [
          { globPattern: '**/*' },
        ],
      }).catch(() => undefined)
    }
  }

  /** ---- Document sync ---- */
  schedule(uri: string, run: () => Promise<void>): void {
    clearTimeout(this.timers.get(uri))
    this.timers.set(uri, setTimeout(() => {
      this.timers.delete(uri)
      void run()
    }, 100))
  }

  async changed(uri: string, text: string | undefined): Promise<void> {
    await this.ready
    const found = this.locate(uri)
    if (!found)
      return
    if (text === undefined)
      found.entry.overlay.clearOverlay(found.path)
    else
      found.entry.overlay.setOverlay(found.path, text)
    await found.entry.project.update([
      { type: 'change', path: found.path },
    ])
  }

  async watched(changes: readonly { uri: string, type: number }[]): Promise<void> {
    await this.ready
    const byProject = new Map<ServerProject, { type: 'create' | 'change' | 'delete', path: string }[]>()
    for (const change of changes) {
      const found = this.locate(change.uri)
      if (!found || found.path.startsWith('node_modules/') || found.path.includes('/node_modules/') || this.documents.get(change.uri))
        continue
      const list = byProject.get(found.entry) ?? []
      byProject.set(found.entry, list)
      list.push({
        type: change.type === FileChangeType.Created
          ? 'create'
          : change.type === FileChangeType.Deleted
            ? 'delete'
            : 'change',
        path: found.path,
      })
    }
    for (const [entry, events] of byProject)
      await entry.project.update(events)
  }

  publishDiagnostics(): void {
    for (const entry of this.projects) {
      const byFile = new Map<string, Diagnostic[]>()
      for (const d of entry.project.analyze().diagnostics) {
        if (!d.location)
          continue
        const uri = this.uriOf(entry, d.location.path)
        const list = byFile.get(uri) ?? []
        byFile.set(uri, list)
        list.push({
          range: this.range(entry, d.location.path, d.location.range),
          severity: severities[d.severity],
          code: d.code,
          source: 'x18n',
          message: d.message,
          data: { key: d.key, locale: d.locale },
        })
      }
      const previous = this.published.get(entry.root) ?? new Set()
      for (const uri of previous) {
        if (!byFile.has(uri))
          void this.connection.sendDiagnostics({ uri, diagnostics: [] })
      }
      for (const [uri, diagnostics] of byFile)
        void this.connection.sendDiagnostics({ uri, diagnostics })
      this.published.set(entry.root, new Set(byFile.keys()))
    }
  }

  /** ---- Symbols ---- */
  entryLocation(entry: ServerProject, node: ResourceNode): Location {
    return this.location(entry, node.path, node.range.key)
  }

  async definition(params: TextDocumentPositionParams): Promise<Location[] | null> {
    await this.ready
    const at = this.at(params)
    const target = at && at.entry.project.keyAt(at.path, at.offset)
    if (!at || !target)
      return null
    const nodes = at.entry.project.locations(target.key)
    const source = nodes.find(node => node.locale === at.entry.project.sourceLocale) ?? nodes[0]
    return source
      ? [
          this.entryLocation(at.entry, source),
        ]
      : null
  }

  async implementation(params: TextDocumentPositionParams): Promise<Location[] | null> {
    await this.ready
    const at = this.at(params)
    const target = at && at.entry.project.keyAt(at.path, at.offset)
    if (!at || !target)
      return null
    return at.entry.project.locations(target.key).map(node => this.entryLocation(at.entry, node))
  }

  async references(params: TextDocumentPositionParams & { context: { includeDeclaration: boolean } }): Promise<Location[] | null> {
    await this.ready
    const at = this.at(params)
    const target = at && at.entry.project.keyAt(at.path, at.offset)
    if (!at || !target)
      return null
    const { project } = at.entry
    const matches = target.type === 'subtree'
      ? project.usages({ prefix: target.key })
      : project.usages({ key: target.key })
    // Locale entries are implementations, not references: siblings stay out of this list.
    return matches.map(m => this.location(at.entry, m.usage.path, m.usage.range))
  }

  async prepareRename(params: TextDocumentPositionParams): Promise<{ range: Range, placeholder: string } | null> {
    await this.ready
    const at = this.at(params)
    const target = at && at.entry.project.keyAt(at.path, at.offset)
    if (!at || !target)
      return null
    return {
      range: this.range(at.entry, at.path, target.range),
      placeholder: target.key,
    }
  }

  async rename(params: TextDocumentPositionParams & { newName: string }): Promise<WorkspaceEdit | null> {
    await this.ready
    const at = this.at(params)
    const target = at && at.entry.project.keyAt(at.path, at.offset)
    if (!at || !target)
      return null
    const { project } = at.entry
    const to = project.parseKey(params.newName.trim())
    const op: EditOp = target.type === 'subtree'
      ? { type: 'rename-prefix', from: target.key, to }
      : { type: 'rename', from: target.key, to }
    const plan = this.plan(project, [op])
    if (plan.warnings.length)
      void this.connection.window.showWarningMessage(`x18n: ${plan.warnings.join(' ')}`)
    return this.workspaceEdit(at.entry, plan)
  }

  plan(project: Project, ops: readonly EditOp[]): Plan {
    try {
      return project.plan(ops)
    }
    catch (error) {
      throw new ResponseError(1, isX18nError(error)
        ? `${error.message}. ${error.fix}`
        : String(error))
    }
  }

  workspaceEdit(entry: ServerProject, plan: Plan): WorkspaceEdit {
    const documentChanges: NonNullable<WorkspaceEdit['documentChanges']>[number][] = []
    const toEdit = (change: FileChange): void => {
      const uri = this.uriOf(entry, change.path)
      if (change.type === 'create') {
        documentChanges.push({
          kind: 'create',
          uri,
          options: { ignoreIfExists: true },
        })
        documentChanges.push({
          textDocument: { uri, version: null },
          edits: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: change.content,
            },
          ],
        })
      }
      else if (change.type === 'delete') {
        documentChanges.push({ kind: 'delete', uri })
      }
      else {
        documentChanges.push({
          textDocument: { uri, version: this.documents.get(uri)?.version ?? null },
          edits: change.edits.map(edit => ({
            range: this.range(entry, change.path, edit.range),
            newText: edit.text,
          })),
        })
      }
    }
    plan.changes.forEach(toEdit)
    return { documentChanges }
  }

  /** ---- Editor features ---- */
  async hover(params: TextDocumentPositionParams): Promise<Hover | null> {
    await this.ready
    const at = this.at(params)
    const target = at && at.entry.project.keyAt(at.path, at.offset)
    if (!at || !target)
      return null
    const { project } = at.entry
    const lines = [`**x18n** \`${target.key}\``, '']
    if (target.type === 'key') {
      const changes = project.locales.map(locale => project.history(target.key, locale))
      const dated = changes.some(Boolean)
      const outdated = new Set(project.analyze().coverage.filter(c => c.outdated.includes(target.key)).map(c => c.locale))
      lines.push(dated ? '| | | |' : '| | |', dated ? '| --- | --- | --- |' : '| --- | --- |')
      project.locales.forEach((locale, i) => {
        const value = display(project.lookup(target.key, locale)?.value)
        const change = changes[i]
        const changed = dated
          ? ` ${change
            ? changedAt(change).replace(/\|/g, '\\|')
            : ''}${outdated.has(locale)
            ? ' · **outdated**'
            : ''} |`
          : ''
        const flag = this.settings.showFlags
          ? project.localeInfo(locale).flag
          : undefined
        lines.push(`| ${flag ?? ''} ${locale} | ${value === undefined
          ? '_missing_'
          : value === ''
            ? '_empty_'
            : value.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |${changed}`)
      })
      const threads = project.reviews({ key: target.key, open: true })
      if (threads.length > 0)
        lines.push('', `**Reviews** ${threads.map(t => `${t.locale}: ${t.state!.replace('-', ' ')}`).join(' · ')}`)
    }
    const usages = target.type === 'subtree'
      ? project.usages({ prefix: target.key })
      : project.usages({ key: target.key })
    const args = encodeURIComponent(JSON.stringify([
      { project: at.entry.name, key: target.key },
    ]))
    lines.push('', `${usages.length} usage${usages.length === 1
      ? ''
      : 's'} · [Open in UI](command:x18n.openKey?${args}) · [Copy translate prompt](command:x18n.copyTranslatePrompt?${args}) · [Translate with agent](command:x18n.translateWithAgent?${args})`)
    return {
      contents: {
        kind: 'markdown',
        value: lines.join('\n'),
      },
      range: this.range(at.entry, at.path, target.range),
    }
  }

  async inlayHints(params: { textDocument: { uri: string }, range: Range }): Promise<InlayHint[]> {
    await this.ready
    const found = this.locate(params.textDocument.uri)
    if (!found)
      return []
    const { entry, path } = found
    const locale = this.displayLocale(entry)
    const index = createLineIndex(this.text(entry, path))
    const start = index.offset(params.range.start)
    const end = index.offset(params.range.end)
    const hints: InlayHint[] = []
    for (const { usage } of entry.project.usages({ path })) {
      if (usage.key === undefined || usage.dynamic !== false || usage.range.start < start || usage.range.end > end)
        continue
      const value = display(entry.project.lookup(usage.key, locale)?.value)
      hints.push({
        position: index.position(usage.range.end + 1),
        label: value === undefined
          ? ' ⚠ missing'
          : ` ${truncate(value, this.settings.annotationMaxLength)}`,
        paddingLeft: true,
      })
    }
    return hints
  }

  async completion(params: TextDocumentPositionParams): Promise<CompletionItem[]> {
    await this.ready
    const at = this.at(params)
    if (!at)
      return []
    const { project } = at.entry
    const slot = project.keySlots(at.path).find(range => at.offset >= range.start && at.offset <= range.end)
    if (!slot)
      return []
    const usage = project.usages({ path: at.path }).map(m => m.usage).find(u => u.range.start === slot.start)
    const scopeNs = usage?.scopeNamespace ?? project.config.namespace.default
    const prefix = usage?.scopePrefix
      ? `${usage.scopePrefix}.`
      : ''
    const range = this.range(at.entry, at.path, slot)
    const { separator, fallback } = project.config.namespace
    const keys = project.keys()
    const known = new Set(keys)
    return keys.flatMap((key) => {
      let insert = key
      if (project.namespaced) {
        const { namespace, path } = splitKey(key)
        const bare = path.join('.')
        // A key of a fallback namespace needs no namespace unless the scope's namespace has it too.
        const implied = namespace === scopeNs || (namespace !== undefined && fallback.includes(namespace) && !known.has(joinKey(scopeNs, path)))
        insert = implied || namespace === undefined
          ? bare
          : `${namespace}${separator}${bare}`
      }
      if (prefix) {
        if (!insert.startsWith(prefix))
          return []
        insert = insert.slice(prefix.length)
      }
      const source = display(project.lookup(key, project.sourceLocale)?.value)
      return [
        {
          label: insert,
          kind: CompletionItemKind.Text,
          ...source === undefined
            ? {}
            : { detail: source },
          textEdit: { range, newText: insert },
          filterText: insert,
        },
      ]
    })
  }

  async codeActions(params: { textDocument: { uri: string }, range: Range, context: { diagnostics: Diagnostic[] } }): Promise<CodeAction[]> {
    await this.ready
    const found = this.locate(params.textDocument.uri)
    if (!found)
      return []
    const { entry, path } = found
    const index = createLineIndex(this.text(entry, path))
    const start = index.offset(params.range.start)
    const end = index.offset(params.range.end)
    const actions: CodeAction[] = []
    for (const d of entry.project.analyze().diagnostics) {
      if (!d.location || d.location.path !== path || d.location.range.end < start || d.location.range.start > end)
        continue
      for (const fix of d.fixes) {
        try {
          actions.push({
            title: fix.title,
            kind: CodeActionKind.QuickFix,
            edit: this.workspaceEdit(entry, entry.project.plan(fix.ops)),
          })
        }
        catch {}
      }
    }
    return [
      ...actions,
      ...this.extractActions(entry, path, start, end),
    ]
  }

  extractActions(entry: ServerProject, path: string, start: number, end: number): CodeAction[] {
    const { project } = entry
    if (project.nodes(path).length > 0)
      return []
    const candidates = findCandidates(project, {
      files: [path],
    })
    const inRange = candidates.filter(c => c.range.start <= end && c.range.end >= start)
    const actions: CodeAction[] = []
    const edit = (list: readonly ExtractCandidate[]): WorkspaceEdit | undefined => {
      try {
        return this.workspaceEdit(entry, project.plan([
          {
            type: 'extract',
            items: extractItems(project, list),
          },
        ]))
      }
      catch {
        return undefined
      }
    }
    const text = this.text(entry, path)
    const index = createLineIndex(text)
    for (const candidate of inRange) {
      const extracted = edit([candidate])
      if (extracted)
        actions.push({ title: `Extract "${truncate(candidate.text, 30)}" to ${candidate.key}`, kind: CodeActionKind.RefactorExtract, edit: extracted })
      const line = index.position(candidate.range.start).line
      const indent = /^\s*/.exec(index.line(line))?.[0] ?? ''
      const markup = /-(?:text|attribute)$/.test(candidate.kind) && !candidate.kind.startsWith('js')
      const comment = markup ? '<!-- x18n-ignore -->' : '// x18n-ignore'
      actions.push({
        title: `Ignore "${truncate(candidate.text, 30)}"`,
        kind: CodeActionKind.QuickFix,
        edit: {
          changes: {
            [this.uriOf(entry, path)]: [
              {
                range: {
                  start: { line, character: 0 },
                  end: { line, character: 0 },
                },
                newText: `${indent}${comment}\n`,
              },
            ],
          },
        },
      })
    }
    if (inRange.length > 0 && candidates.length > 1) {
      const all = edit(candidates)
      if (all)
        actions.push({ title: `Extract all ${candidates.length} hard strings in this file`, kind: CodeActionKind.RefactorExtract, edit: all })
    }
    return actions
  }

  async documentSymbols(params: { textDocument: { uri: string } }): Promise<DocumentSymbol[]> {
    await this.ready
    const found = this.locate(params.textDocument.uri)
    if (!found)
      return []
    const { entry, path } = found
    const roots: DocumentSymbol[] = []
    const stack: { key: string, symbol: DocumentSymbol }[] = []
    for (const node of entry.project.nodes(path)) {
      while (stack.length && !node.key.startsWith(`${stack.at(-1)!.key}.`))
        stack.pop()
      const parentKey = stack.at(-1)?.key
      const symbol: DocumentSymbol = {
        name: parentKey
          ? node.key.slice(parentKey.length + 1)
          : node.key,
        detail: node.leaf
          ? display(entry.project.message(node.key, node.locale)?.value) ?? ''
          : '',
        kind: node.leaf ? SymbolKind.String : SymbolKind.Namespace,
        range: this.range(entry, path, {
          start: node.range.key.start,
          end: Math.max(node.range.value.end, node.range.key.end),
        }),
        selectionRange: this.range(entry, path, node.range.key),
        children: [],
      }
      if (stack.length)
        stack.at(-1)!.symbol.children!.push(symbol)
      else
        roots.push(symbol)
      if (!node.leaf)
        stack.push({ key: node.key, symbol })
    }
    return roots
  }

  async workspaceSymbols(params: { query: string }): Promise<SymbolInformation[]> {
    await this.ready
    const query = params.query.toLowerCase()
    const out: SymbolInformation[] = []
    for (const entry of this.projects) {
      for (const key of entry.project.keys()) {
        const value = display(entry.project.message(key, entry.project.sourceLocale)?.value) ?? ''
        if (query && !key.toLowerCase().includes(query) && !value.toLowerCase().includes(query))
          continue
        const node = entry.project.locations(key)[0]
        if (node) {
          out.push({
            name: key,
            kind: SymbolKind.String,
            containerName: value,
            location: this.entryLocation(entry, node),
          })
        }
        if (out.length >= 500)
          return out
      }
    }
    return out
  }

  async codeLenses(params: { textDocument: { uri: string } }): Promise<CodeLens[]> {
    await this.ready
    const found = this.locate(params.textDocument.uri)
    if (!this.settings.codeLens || !found)
      return []
    const { entry, path } = found
    return entry.project.nodes(path).filter(node => node.leaf).map((node) => {
      const info = entry.project.get(node.key)
      const used = info?.usages.length ?? 0
      const missing = info?.missing ?? []
      const title = `used ${used} time${used === 1
        ? ''
        : 's'}${missing.length
        ? ` · missing in ${missing.join(', ')}`
        : ''}`
      return {
        range: this.range(entry, path, node.range.key),
        command: { title, command: '' },
      }
    })
  }

  async executeCommand(params: { command: string, arguments?: unknown[] }): Promise<unknown> {
    await this.ready
    const arg: unknown = params.arguments?.[0]
    if (typeof arg !== 'object' || arg === null)
      return null
    const input = arg as { project?: string, key?: string, locale?: string, value?: string, to?: string, uri?: string, id?: string, review?: string, text?: string, suggestion?: string } // client-supplied; fields checked below
    if (params.command === commands.review || params.command === commands.resolveReview || params.command === commands.applySuggestion)
      return this.reviewCommand(params.command, input)
    if (params.command === commands.extract && typeof input.uri === 'string')
      return this.extractFile(input.uri)
    if (params.command === commands.migrateI18nAlly && typeof input.uri === 'string')
      return migrateI18nAlly(fileURLToPath(input.uri))
    const entry = this.projects.find(p => p.name === input.project) ?? this.projects[0]
    if (!entry || typeof input.key !== 'string')
      return null
    const key = entry.project.parseKey(input.key)
    let op: EditOp | undefined
    if (params.command === commands.set && typeof input.value === 'string') {
      op = {
        type: 'set',
        key,
        locale: input.locale ?? entry.project.sourceLocale,
        value: input.value,
      }
    }
    else if (params.command === commands.delete) {
      op = {
        type: 'delete',
        key,
        locales: input.locale
          ? [input.locale]
          : 'all',
      }
    }
    else if (params.command === commands.renamePrefix && typeof input.to === 'string') {
      op = {
        type: 'rename-prefix',
        from: key,
        to: entry.project.parseKey(input.to),
      }
    }
    if (!op)
      return null
    const edit = this.workspaceEdit(entry, this.plan(entry.project, [op]))
    await this.connection.workspace.applyEdit(edit)
    return edit
  }

  /** Review commands write at once: a comment is not an edit to review in the editor. */
  async reviewCommand(command: string, input: { project?: string, key?: string, locale?: string, id?: string, review?: string, text?: string, suggestion?: string }): Promise<{ revision: number } | null> {
    const entry = this.entryByName(input.project)
    if (!entry)
      return null
    const { project } = entry
    const review = reviewTypes.find(type => type === input.review)
    let op: EditOp | undefined
    if (command === commands.review && typeof input.key === 'string' && typeof input.locale === 'string' && review) {
      op = {
        type: 'review',
        key: project.parseKey(input.key),
        locale: input.locale,
        review,
        text: typeof input.text === 'string'
          ? input.text
          : undefined,
        suggestion: typeof input.suggestion === 'string'
          ? input.suggestion
          : undefined,
        author: await project.reviewAuthor(),
      }
    }
    else if (typeof input.id === 'string') {
      op = command === commands.resolveReview
        ? { type: 'resolve-review', id: input.id }
        : { type: 'apply-suggestion', id: input.id }
    }
    if (!op)
      return null
    try {
      return { revision: (await project.apply(this.plan(project, [op]))).revision }
    }
    catch (error) {
      throw isX18nError(error)
        ? new ResponseError(1, `${error.message}. ${error.fix}`)
        : error
    }
  }

  reviews(params: P.ReviewsParams): P.ReviewsResult {
    const entries = params.project === undefined
      ? this.projects
      : this.projects.filter(p => p.name === params.project)
    return {
      threads: entries.flatMap(entry => entry.project.reviews({
        key: params.key === undefined
          ? undefined
          : entry.project.parseKey(params.key),
        locale: params.locale,
        open: params.open,
      }).map((thread): P.ReviewThreadInfo => {
        const node = entry.project.locations(thread.key).find(n => n.locale === thread.locale && n.leaf)
        return {
          ...thread,
          project: entry.name,
          location: node && this.entryLocation(entry, node),
        }
      })),
    }
  }

  async extractFile(uri: string): Promise<WorkspaceEdit | null> {
    const found = this.locate(uri)
    if (!found)
      return null
    const { entry, path } = found
    const candidates = findCandidates(entry.project, {
      files: [path],
    })
    if (candidates.length === 0)
      return null
    const edit = this.workspaceEdit(entry, this.plan(entry.project, [
      {
        type: 'extract',
        items: extractItems(entry.project, candidates),
      },
    ]))
    await this.connection.workspace.applyEdit(edit)
    return edit
  }

  /** ---- Custom protocol ---- */
  entryByName(name: string | undefined): ServerProject | undefined {
    return name === undefined
      ? this.projects[0]
      : this.projects.find(p => p.name === name)
  }

  /** `x18n doctor` for every folder: load errors, then how each project was understood. */
  explain(): string {
    if (this.folders.length === 0)
      return 'No workspace folder is open.'
    return [
      ...this.failures.map(({ folder, error }) => [
        `# ${folder}`,
        `error: ${error.name} ${error.why}`,
        ...error.fix
          ? [
              `fix: ${error.fix}`,
            ]
          : [],
      ].join('\n')),
      ...this.projects.map(entry => renderExplanation(entry.project.explain(), entry.configFile)),
    ].join('\n\n')
  }

  projectInfos(): P.ProjectInfo[] {
    return this.projects.map(entry => ({
      name: entry.name,
      root: entry.root,
      sourceLocale: entry.project.sourceLocale,
      locales: entry.project.locales.map(code => ({ code, displayName: entry.project.localeInfo(code).displayName, flag: entry.project.localeInfo(code).flag })),
      displayLocale: this.displayLocale(entry),
      keys: entry.project.keys().length,
    }))
  }

  async keyAt(params: P.PositionParams): Promise<P.KeyAtResult | null> {
    await this.ready
    const at = this.at({
      textDocument: { uri: params.uri },
      position: params.position,
    })
    const target = at && at.entry.project.keyAt(at.path, at.offset)
    if (!at || !target)
      return null
    return {
      project: at.entry.name,
      key: target.key,
      type: target.type,
      range: this.range(at.entry, at.path, target.range),
    }
  }

  tree(params: P.TreeParams): P.TreeNode[] {
    const entry = this.entryByName(params.project)
    if (!entry)
      return []
    const { project } = entry
    const locale = this.displayLocale(entry)
    const parent = params.parent
    const children = new Map<string, KeyString[]>()
    for (const key of project.keys()) {
      if (parent !== undefined && !key.startsWith(project.namespaced && parent.endsWith(':')
        ? parent
        : `${parent}.`)) {
        continue
      }
      const rest = parent === undefined
        ? key
        : key.slice(parent.length + (parent.endsWith(':')
            ? 0
            : 1))
      const ns = parent === undefined && project.namespaced
        ? rest.slice(0, rest.indexOf(':') + 1)
        : ''
      const segment = ns || rest.split('.')[0]!
      const child = parent === undefined
        ? segment
        : `${parent}${parent.endsWith(':')
          ? ''
          : '.'}${segment}`
      const list = children.get(child) ?? []
      children.set(child, list)
      list.push(key)
    }
    const others = project.locales.filter(l => l !== project.sourceLocale)
    return [...children].map(([key, keys]) => {
      const leaf = keys.length === 1 && keys[0] === key
      const filled = (k: KeyString, l: string): boolean => !['', undefined].includes(display(project.message(k, l)?.value))
      const translated = keys.reduce((sum, k) => sum + others.filter(l => filled(k, l)).length, 0)
      return {
        key,
        label: key.slice((parent?.length ?? -1) + 1).replace(/:$/, '') || key,
        leaf,
        translated,
        total: keys.length * others.length,
        value: leaf
          ? display(project.message(key, locale)?.value)
          : undefined,
      }
    })
  }

  progress(): P.ProgressResult {
    return {
      projects: this.projects.map(entry => ({
        name: entry.name,
        locales: entry.project.analyze().coverage.map(c => ({
          locale: c.locale,
          translated: c.translated,
          total: c.total,
          missing: c.missing,
          empty: c.empty,
        })),
      })),
    }
  }

  async fileKeys(params: P.DocumentParams): Promise<P.FileKeysResult> {
    await this.ready
    const found = this.locate(params.uri)
    if (!found)
      return { keys: [], hardStrings: [] }
    const { entry, path } = found
    const locale = this.displayLocale(entry)
    const isResource = entry.project.nodes(path).length > 0
    const keys: P.FileKey[] = isResource
      ? entry.project.nodes(path).filter(n => n.leaf).map(n => ({
          key: n.key,
          range: this.range(entry, path, n.range.key),
          value: display(entry.project.message(n.key, locale)?.value),
          missing: entry.project.get(n.key)!.missing.length > 0,
          dynamic: false,
        }))
      : entry.project.usages({ path }).flatMap(({ usage }) => usage.key === undefined
          ? []
          : [
              {
                key: usage.key,
                range: this.range(entry, path, usage.range),
                value: display(entry.project.lookup(usage.key, locale)?.value),
                missing: usage.dynamic === false && entry.project.lookup(usage.key, entry.project.sourceLocale) === undefined,
                dynamic: usage.dynamic !== false,
              },
            ])
    const hardStrings = entry.project.hardStrings(path).map(h => ({
      text: h.text,
      range: this.range(entry, path, h.range),
    }))
    return { keys, hardStrings }
  }

  usageReport(): P.UsageReportResult {
    const unused: P.UsageReportResult['unused'][number][] = []
    const missing: P.UsageReportResult['missing'][number][] = []
    for (const entry of this.projects) {
      const analysis = entry.project.analyze()
      for (const key of analysis.unused) {
        const node = entry.project.locations(key)[0]
        unused.push({
          project: entry.name,
          key,
          location: node
            ? this.entryLocation(entry, node)
            : undefined,
        })
      }
      const byKey = new Map<string, Location[]>()
      for (const usage of analysis.undefinedUsages) {
        const list = byKey.get(usage.key!) ?? []
        byKey.set(usage.key!, list)
        list.push(this.location(entry, usage.path, usage.range))
      }
      for (const [key, locations] of byKey)
        missing.push({ project: entry.name, key, locations })
    }
    return { unused, missing }
  }

  /** Matches of every project, best first. */
  search(params: P.SearchParams): P.SearchMatch[] {
    const found = this.projects.flatMap(entry => entry.project.search(params.query, { exact: params.exact }).map(match => ({ entry, match })))
    return found.sort((a, b) => b.match.score - a.match.score).slice(0, 100).map(({ entry, match }) => {
      const { project } = entry
      const node = project.locations(match.key).find(node => node.locale === match.locale)
      return {
        project: entry.name,
        key: match.key,
        locale: match.locale,
        value: match.value,
        definition: node && this.entryLocation(entry, node),
        usages: project.usages({ key: match.key }).map(m => this.location(entry, m.usage.path, m.usage.range)),
      }
    })
  }

  async decorations(params: P.DocumentParams): Promise<P.DecorationsResult> {
    await this.ready
    const found = this.locate(params.uri)
    if (!found || found.entry.project.nodes(found.path).length > 0)
      return { locale: this.settings.displayLocale ?? '', decorations: [] }
    const { entry, path } = found
    const locale = this.displayLocale(entry)
    return {
      locale,
      decorations: entry.project.usages({ path }).flatMap(({ usage }) => {
        if (usage.key === undefined)
          return []
        const value = display(entry.project.lookup(usage.key, locale)?.value)
        const state = usage.dynamic !== false
          ? 'dynamic' as const
          : value === undefined
            ? 'missing' as const
            : 'ok' as const
        return [
          {
            range: this.range(entry, path, usage.range),
            ...usage.expression
              ? {
                  expression: this.range(entry, path, usage.expression),
                }
              : {},
            key: usage.key,
            value,
            state,
          },
        ]
      }),
    }
  }
}

/** Registers the x18n handlers on a connection. The caller owns transport and `listen()`. */
export function setupServer(connection: Connection, options: ServerOptions = {}): void {
  // The UI pulls in devframe; load it on the first `x18n/openUi` only.
  let ui: Promise<UiServers> | undefined
  const openUi = options.openUi ?? (async (entry: ServerProject) => (await (ui ??= import('./ui').then(m => m.createUiServers(connection)))).open(entry))
  connection.onShutdown(async () => {
    await (await ui)?.close()
  })
  const server = new Server(connection, options)
  server.documents.listen(connection)
  connection.onInitialize(params => server.initialize(params))
  connection.onInitialized(() => void server.initialized())
  server.documents.onDidChangeContent(({ document }) => server.schedule(document.uri, () => server.changed(document.uri, document.getText())))
  server.documents.onDidClose(({ document }) => server.schedule(document.uri, () => server.changed(document.uri, undefined)))
  connection.onDidChangeWatchedFiles(params => void server.watched(params.changes))
  connection.onDefinition(params => server.definition(params))
  connection.onImplementation(params => server.implementation(params))
  connection.onReferences(params => server.references(params))
  connection.onPrepareRename(params => server.prepareRename(params))
  connection.onRenameRequest(params => server.rename(params))
  connection.onHover(params => server.hover(params))
  connection.languages.inlayHint.on(params => server.inlayHints(params))
  connection.onCompletion(params => server.completion(params))
  connection.onCodeAction(params => server.codeActions(params))
  connection.onDocumentSymbol(params => server.documentSymbols(params))
  connection.onWorkspaceSymbol(params => server.workspaceSymbols(params))
  connection.onCodeLens(params => server.codeLenses(params))
  connection.onExecuteCommand(params => server.executeCommand(params))
  connection.onRequest(methods.projects, async () => {
    await server.ready
    return server.projectInfos()
  })
  connection.onRequest(methods.keyAt, (params: P.PositionParams) => server.keyAt(params))
  connection.onRequest(methods.tree, async (params: P.TreeParams) => {
    await server.ready
    return server.tree(params ?? {})
  })
  connection.onRequest(methods.progress, async () => {
    await server.ready
    return server.progress()
  })
  connection.onRequest(methods.fileKeys, (params: P.DocumentParams) => server.fileKeys(params))
  connection.onRequest(methods.usageReport, async () => {
    await server.ready
    return server.usageReport()
  })
  connection.onRequest(methods.search, async (params: P.SearchParams) => {
    await server.ready
    return server.search(params)
  })
  connection.onRequest(methods.decorations, (params: P.DocumentParams) => server.decorations(params))
  connection.onNotification(methods.setDisplayLocale, (params: P.SetDisplayLocaleParams) => {
    server.settings.displayLocale = params.locale
    void connection.languages.inlayHint.refresh().catch(() => undefined)
  })
  connection.onRequest(methods.openUi, async (params: P.OpenUiParams) => {
    await server.ready
    const entry = server.entryByName(params?.project)
    if (!entry)
      throw new ResponseError(1, `No project "${params?.project ?? ''}" in this server.`)
    return openUi(entry)
  })
  connection.onRequest(methods.reviews, async (params: P.ReviewsParams | undefined) => {
    await server.ready
    return server.reviews(params ?? {})
  })
  connection.onRequest(methods.explain, async () => {
    await server.ready
    return server.explain()
  })
  connection.onRequest(methods.translatePrompt, async (params: P.TranslatePromptParams) => {
    await server.ready
    const entry = server.entryByName(params.project)
    if (!entry)
      throw new ResponseError(1, `Unknown project "${params.project}".`)
    return renderPrompt(entry.project.prompt('translate', params.locale, { keys: params.keys }))
  })
}
