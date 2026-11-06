import type { Location, ProjectInfo, ReviewCommentInfo, SearchMatch } from '@x18n/lsp'
import type { LanguageClient } from 'vscode-languageclient/node'
import type { DisplayLocale } from './display-locale'
import type { KeyRef, X18nClient } from './model/client'
import { commands as serverCommands } from '@x18n/lsp'
import { useCommand } from 'reactive-vscode'
import { ConfigurationTarget, env, Range, Selection, TextEditorRevealType, Uri, commands as vscodeCommands, window, workspace } from 'vscode'
import { CodeActionKind, CodeActionRequest, ExecuteCommandRequest } from 'vscode-languageclient/node'
import { annotationInPlace, config } from './config'
import { flagIcon } from './flags'
import { commands } from './generated/meta'
import { migratableFolders, migrate } from './migrate'
import { isKeyRef, projectFor } from './model/client'
import { l10n } from './model/l10n'
import { languages } from './model/languages'
import { adjacentRange } from './model/locations'

interface CommandDeps {
  readonly client: LanguageClient
  readonly x18n: X18nClient
  readonly openUi: (ref?: Partial<KeyRef>) => Promise<void>
  readonly displayLocale: DisplayLocale
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error)
}

/** Tree items carry their key under `item.ref`; hover links and callers pass a `KeyRef`. */
function refOf(arg: unknown): KeyRef | undefined {
  if (isKeyRef(arg))
    return arg
  if (typeof arg === 'object' && arg !== null && 'item' in arg && typeof arg.item === 'object' && arg.item !== null && 'ref' in arg.item && isKeyRef(arg.item.ref))
    return arg.item.ref
  return undefined
}

async function open(location: Location): Promise<void> {
  const { start, end } = location.range
  await window.showTextDocument(Uri.parse(location.uri), {
    selection: new Range(start.line, start.character, end.line, end.character),
  })
}

/** The matched value's usages, or its locale entry when no code uses the key. */
async function openMatch(match: SearchMatch): Promise<void> {
  const targets = match.usages.length > 0
    ? match.usages
    : match.definition
      ? [match.definition]
      : []
  const picked = targets.length > 1
    ? (await window.showQuickPick(targets.map(location => ({
        label: `${workspace.asRelativePath(Uri.parse(location.uri))}:${location.range.start.line + 1}`,
        location,
      })), {
        placeHolder: l10n.t('Usages of {0}', match.key),
      }))?.location
    : targets[0]
  if (picked)
    await open(picked)
}

/** A quick pick description, with ` · current` added on the picked option. */
function markCurrent(isCurrent: boolean, description: string): string {
  return isCurrent
    ? [
        description,
        l10n.t('current'),
      ].filter(Boolean).join(' · ')
    : description
}

async function localeItem(locale: ProjectInfo['locales'][number]): Promise<{ label: string, code: string, iconPath?: Uri }> {
  const icon = await flagIcon(locale.code, locale.flag)
  return {
    label: locale.code,
    code: locale.code,
    ...icon
      ? { iconPath: icon }
      : {},
  }
}

function reviewChoices(): { readonly label: string, readonly review: ReviewCommentInfo['type'], readonly prompt: string }[] {
  return [
    {
      label: l10n.t('Comment'),
      review: 'comment',
      prompt: l10n.t('Comment'),
    },
    {
      label: l10n.t('Approve'),
      review: 'approve',
      prompt: l10n.t('Comment (optional)'),
    },
    {
      label: l10n.t('Request change'),
      review: 'request-change',
      prompt: l10n.t('What should change'),
    },
    {
      label: l10n.t('Suggest a value'),
      review: 'suggestion',
      prompt: l10n.t('Suggested value'),
    },
  ]
}

/** Display locale, translate prompt, review and key commands. `x18n.extract` is the server's command, see `client.ts`. */
export function useCommands({ client, x18n, openUi, displayLocale }: CommandDeps): { extractAtCursor: () => Promise<void>, execute: (command: string, arg: object) => Promise<unknown> } {
  const execute = (command: string, arg: object): Promise<unknown> => client.sendRequest(ExecuteCommandRequest.type, {
    command,
    arguments: [arg],
  })

  async function keyAtCursor(): Promise<KeyRef | undefined> {
    const editor = window.activeTextEditor
    if (!editor)
      return undefined
    const at = await x18n.request('x18n/keyAt', {
      uri: editor.document.uri.toString(),
      position: editor.selection.active,
    })
    return at
      ? { project: at.project, key: at.key }
      : undefined
  }

  async function resolveRef(arg: unknown): Promise<KeyRef | undefined> {
    const ref = refOf(arg) ?? await keyAtCursor()
    if (!ref)
      void window.showWarningMessage(l10n.t('x18n: no key under the cursor.'))
    return ref
  }

  async function project(name?: string): Promise<ProjectInfo | undefined> {
    const projects = await x18n.request('x18n/projects', undefined)
    const path = window.activeTextEditor?.document.uri.fsPath
    return projects.find(p => p.name === name) ?? (path === undefined
      ? undefined
      : projectFor(projects, path)) ?? projects[0]
  }

  async function pickLocale(info: ProjectInfo, placeHolder: string, skipSource = false): Promise<string | undefined> {
    const items = await Promise.all(info.locales.filter(l => !skipSource || l.code !== info.sourceLocale).map(async l => ({
      ...await localeItem(l),
      description: [
        l.displayName,
        l.code === info.sourceLocale
          ? l10n.t('source')
          : undefined,
      ].filter(Boolean).join(' · '),
    })))
    return (await window.showQuickPick(items, { placeHolder }))?.code
  }

  const register = (command: string, run: (...args: unknown[]) => Promise<unknown>): void => {
    useCommand(command, (...args: unknown[]) => run(...args).catch(error => window.showErrorMessage(`x18n: ${message(error)}`)))
  }

  register(commands.openUi, async () => openUi({ project: (await project())?.name }))
  register(commands.openKey, async (arg) => {
    const ref = await resolveRef(arg)
    if (ref)
      await openUi(ref)
  })

  register(commands.findKeyByText, async () => {
    const editor = window.activeTextEditor
    const selected = editor?.document.getText(editor.selection).trim() ?? ''
    const pick = window.createQuickPick<{ label: string, description: string, detail: string, alwaysShow: boolean, match: SearchMatch }>()
    pick.placeholder = l10n.t('Text shown in the app, in any locale')
    const search = async (query: string): Promise<void> => {
      pick.busy = true
      const matches = await x18n.request('x18n/search', { query })
      if (pick.value !== query)
        return
      const projects = new Set(matches.map(m => m.project))
      pick.items = matches.map(match => ({
        label: match.value,
        description: projects.size > 1
          ? `${match.project} · ${match.key}`
          : match.key,
        detail: `${match.locale} · ${l10n.t('Usages: {0}', match.usages.length)}`,
        // The server matches fuzzily; the quick pick's own filter would hide some matches.
        alwaysShow: true,
        match,
      }))
      pick.busy = false
    }
    const fail = (error: unknown): void => void window.showErrorMessage(`x18n: ${message(error)}`)
    if (!selected.includes('\n'))
      pick.value = selected
    pick.onDidChangeValue(query => search(query).catch(fail))
    pick.onDidAccept(() => {
      const match = pick.selectedItems[0]?.match
      pick.dispose()
      if (match)
        openMatch(match).catch(fail)
    })
    pick.onDidHide(() => pick.dispose())
    pick.show()
    if (pick.value)
      await search(pick.value)
  })

  register(commands.setLanguage, async () => {
    const current = config.language ?? ''
    const marked = (code: string, description: string): string => markCurrent(code === current, description)
    const picked = await window.showQuickPick([
      {
        label: l10n.t('Same as VS Code'),
        description: marked('', ''),
        code: '',
      },
      ...languages.map(l => ({
        label: l.name,
        description: marked(l.code, l.code),
        code: l.code,
      })),
    ], {
      placeHolder: l10n.t('Language of x18n\'s views, pickers and messages'),
    })
    // A user setting: the language is the person's, not the project's. `language.ts` applies it.
    if (picked && picked.code !== current)
      await config.update('language', picked.code, ConfigurationTarget.Global)
  })

  register(commands.setDisplayLocale, async () => {
    const projects = await x18n.request('x18n/projects', undefined)
    const locales = [
      ...new Map(projects.flatMap(p => p.locales).map(l => [l.code, l])).values(),
    ]
    const sourceLocales = projects.map(p => p.sourceLocale).join(', ')
    const current = displayLocale.picked.value
    const marked = (code: string | undefined, description: string): string => markCurrent(code === current, description)
    const picked = await window.showQuickPick([
      {
        label: l10n.t('Default'),
        description: marked(undefined, config.displayLocale
          ? l10n.t('x18n.displayLocale setting ({0})', config.displayLocale)
          : l10n.t('x18n.displayLocale setting, else the source locale ({0})', sourceLocales)),
        code: undefined,
      },
      {
        label: l10n.t('Source locale'),
        description: marked('', sourceLocales),
        code: '',
      },
      ...await Promise.all(locales.map(async l => ({
        ...await localeItem(l),
        description: marked(l.code, l.displayName ?? ''),
      }))),
    ], {
      placeHolder: l10n.t('Locale shown in annotations, for this workspace only'),
    })
    // Kept in the workspace state, never in `.vscode/settings.json`; the watcher in `index.ts` tells the server.
    if (picked)
      await displayLocale.pick(picked.code)
  })

  register(commands.editKey, async (arg) => {
    const ref = await resolveRef(arg)
    const info = ref && await project(ref.project)
    if (!ref || !info)
      return
    const locale = await pickLocale(info, l10n.t('Locale of {0} to edit', ref.key))
    const value = locale && await window.showInputBox({
      title: `${ref.key} (${locale})`,
      prompt: l10n.t('New message'),
    })
    if (value) {
      await execute(serverCommands.set, {
        project: info.name,
        key: ref.key,
        locale,
        value,
      })
    }
  })

  register(commands.addReview, async (arg) => {
    const ref = await resolveRef(arg)
    const info = ref && await project(ref.project)
    const locale = ref && info && await pickLocale(info, l10n.t('Locale of {0} to review', ref.key))
    const choice = locale && await window.showQuickPick(reviewChoices(), {
      placeHolder: l10n.t('Review {0} ({1})', ref.key, locale),
    })
    if (!ref || !info || !locale || !choice)
      return
    const text = await window.showInputBox({ title: `${choice.label}: ${ref.key} (${locale})`, prompt: choice.prompt })
    if (text === undefined || (!text && choice.review !== 'approve'))
      return
    await execute(serverCommands.review, {
      project: info.name,
      key: ref.key,
      locale,
      review: choice.review,
      ...choice.review === 'suggestion'
        ? { suggestion: text }
        : text
          ? { text }
          : {},
    })
  })

  register(commands.renameKeyPrefix, async (arg) => {
    const ref = await resolveRef(arg)
    const to = ref && await window.showInputBox({
      title: l10n.t('Rename {0}.*', ref.key),
      value: ref.key,
      valueSelection: [0, ref.key.length],
    })
    if (to && to !== ref.key)
      await execute(serverCommands.renamePrefix, { project: ref.project, key: ref.key, to })
  })

  register(commands.deleteKey, async (arg) => {
    const ref = await resolveRef(arg)
    const remove = l10n.t('Delete')
    if (ref && await window.showWarningMessage(l10n.t('Delete {0} from every locale?', ref.key), { modal: true }, remove) === remove)
      await execute(serverCommands.delete, { project: ref.project, key: ref.key })
  })

  // The server plans with `x18n/unusedDeletion` (the dry run), and the edit lands in the editor, where undo works.
  register(commands.deleteUnusedKeys, async () => {
    const { projects } = await x18n.request('x18n/unusedDeletion', {})
    const keys = projects.reduce((n, p) => n + p.keys.length, 0)
    const kept = projects.reduce((n, p) => n + p.kept.length, 0)
    const warnings = projects.flatMap(p => p.warnings)
    if (keys === 0) {
      void window.showInformationMessage(kept
        ? l10n.t('x18n: no unused keys to delete. Kept, as dynamic usages may reach them: {0}.', kept)
        : l10n.t('x18n: no unused keys to delete.'))
      return
    }
    const files = new Set(projects.flatMap(p => p.keys.flatMap(k => k.locations.map(l => l.uri))))
    const detail = [
      ...projects.flatMap(p => p.keys.map(k => projects.length > 1
        ? `${p.project}: ${k.key}`
        : k.key)).slice(0, 20),
      ...keys > 20
        ? [
            l10n.t('and {0} more', keys - 20),
          ]
        : [],
      ...kept
        ? [
            ``,
            l10n.t('Unused keys kept, as dynamic usages may reach them: {0}.', kept),
          ]
        : [],
      ...warnings.length
        ? [``, ...warnings]
        : [],
    ].join('\n')
    const remove = l10n.t('Delete')
    const answer = await window.showWarningMessage(l10n.t('Delete unused keys? Keys: {0}. Files: {1}.', keys, files.size), { modal: true, detail }, remove)
    if (answer === remove)
      await execute(serverCommands.deleteUnused, {})
  })

  register(commands.extractFile, async () => {
    const uri = window.activeTextEditor?.document.uri.toString()
    if (uri && await execute(serverCommands.extract, { uri }) === null)
      void window.showInformationMessage(l10n.t('x18n: no hard strings in this file.'))
  })

  async function translatePrompt(arg: unknown): Promise<{ locale: string, prompt: string } | undefined> {
    const ref = refOf(arg)
    const info = await project(ref?.project)
    const locale = info && await pickLocale(info, l10n.t('Translate into'), true)
    if (!locale)
      return undefined
    return { locale, prompt: await x18n.request('x18n/translatePrompt', {
      project: info.name,
      locale,
      keys: ref
        ? [ref.key]
        : undefined,
    }) }
  }

  register(commands.copyTranslatePrompt, async (arg) => {
    const found = await translatePrompt(arg)
    if (!found)
      return
    await env.clipboard.writeText(found.prompt)
    void window.showInformationMessage(l10n.t('x18n: translate prompt for {0} copied.', found.locale))
  })

  // The editor's agent follows the prompt's own `x18n apply` and `x18n check` steps, so x18n calls no model itself (D39).
  register(commands.translateWithAgent, async (arg) => {
    const found = await translatePrompt(arg)
    if (!found)
      return
    if ((await vscodeCommands.getCommands(true)).includes('workbench.action.chat.open')) {
      await vscodeCommands.executeCommand('workbench.action.chat.open', { query: found.prompt, mode: 'agent' })
      return
    }
    await env.clipboard.writeText(found.prompt)
    void window.showInformationMessage(l10n.t('x18n: this editor has no chat agent; translate prompt for {0} copied.', found.locale))
  })

  const goToUsage = (direction: 1 | -1) => async (): Promise<void> => {
    const editor = window.activeTextEditor
    if (!editor)
      return
    const { keys } = await x18n.request('x18n/fileKeys', {
      uri: editor.document.uri.toString(),
    })
    const target = adjacentRange(keys.map(k => k.range), editor.selection.active, direction)
    if (!target)
      return
    const range = new Range(target.start.line, target.start.character, target.end.line, target.end.character)
    editor.selection = new Selection(range.start, range.end)
    editor.revealRange(range, TextEditorRevealType.InCenterIfOutsideViewport)
  }
  register(commands.goToNextUsage, goToUsage(1))
  register(commands.goToPrevUsage, goToUsage(-1))

  register(commands.toggleInPlace, async () => config.update('annotationInPlace', !annotationInPlace(), ConfigurationTarget.Global))
  register(commands.restartServer, () => client.restart())
  register(commands.showOutput, async () => client.outputChannel.show())
  register(commands.explainProjects, async () => {
    client.outputChannel.appendLine(await x18n.request('x18n/explain', undefined))
    client.outputChannel.show()
  })

  register(commands.migrateFromI18nAlly, async () => {
    const folders = await migratableFolders()
    const folder = folders.length > 1
      ? (await window.showQuickPick(folders.map(f => ({ label: f.name, folder: f })), {
          placeHolder: l10n.t('Folder to migrate'),
        }))?.folder
      : folders[0]
    if (!folder) {
      if (folders.length === 0)
        void window.showInformationMessage(l10n.t('x18n: no folder with i18n-ally settings and without an x18n config.'))
      return
    }
    // The server loads projects once at start, so the new config needs a restart.
    if (await migrate(client, folder))
      await client.restart()
  })

  async function extractAtCursor(): Promise<void> {
    const editor = window.activeTextEditor
    if (!editor)
      return
    const { document, selection } = editor
    const actions = await client.sendRequest(CodeActionRequest.type, {
      textDocument: {
        uri: document.uri.toString(),
      },
      range: client.code2ProtocolConverter.asRange(selection),
      context: {
        diagnostics: [],
        only: [CodeActionKind.RefactorExtract],
      },
    })
    const extracts = (actions ?? []).filter(a => 'kind' in a && a.kind === CodeActionKind.RefactorExtract && a.edit)
    const picked = extracts.length > 1
      ? await window.showQuickPick(extracts.map(a => ({ label: a.title, action: a })), {
          placeHolder: l10n.t('Extract'),
        })
      : { action: extracts[0] }
    if (!picked?.action || !('edit' in picked.action) || !picked.action.edit) {
      if (extracts.length === 0)
        void window.showInformationMessage(l10n.t('x18n: no hard string to extract here.'))
      return
    }
    await workspace.applyEdit(await client.protocol2CodeConverter.asWorkspaceEdit(picked.action.edit))
  }

  return { extractAtCursor, execute }
}
