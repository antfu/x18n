import type { WorkspaceFolder } from 'vscode'
import type { LanguageClient } from 'vscode-languageclient/node'
import { RelativePattern, Uri, window, workspace } from 'vscode'
import { ExecuteCommandRequest } from 'vscode-languageclient/node'
import { l10n } from './model/l10n'
import { hasI18nAllySettings, parseMigrationResult } from './model/migration'

async function readText(uri: Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await workspace.fs.readFile(uri))
  }
  catch {
    return undefined
  }
}

/** Folders with `i18n-ally.*` settings and no `x18n.config.*`. */
export async function migratableFolders(): Promise<WorkspaceFolder[]> {
  const folders: WorkspaceFolder[] = []
  for (const folder of workspace.workspaceFolders ?? []) {
    const settings = await readText(Uri.joinPath(folder.uri, '.vscode', 'settings.json'))
    if (settings === undefined || !hasI18nAllySettings(settings))
      continue
    const configs = await workspace.findFiles(new RelativePattern(folder, 'x18n.config.*'), null, 1)
    if (configs.length === 0)
      folders.push(folder)
  }
  return folders
}

/** Previews the generated files, then writes them on confirmation. Resolves `true` once written. */
export async function migrate(client: LanguageClient, folder: WorkspaceFolder): Promise<boolean> {
  // A dry run: the server returns the files and the extension writes them, so the user sees them first.
  const preview = parseMigrationResult(await client.sendRequest(ExecuteCommandRequest.type, {
    command: 'x18n.migrateI18nAlly',
    arguments: [
      {
        uri: folder.uri.toString(),
        dryRun: true,
      },
    ],
  }))
  if (!preview || preview.files.length === 0) {
    void window.showWarningMessage(`${l10n.t('x18n: nothing to migrate in {0}.', folder.name)}${preview?.notes.length
      ? ` ${preview.notes.join(' ')}`
      : ''}`)
    return false
  }
  for (const file of preview.files) {
    const language = /\.ya?ml$/.test(file.path)
      ? 'yaml'
      : /\.json$/.test(file.path)
        ? 'json'
        : 'typescript'
    await window.showTextDocument(await workspace.openTextDocument({ content: file.content, language }), { preview: false })
  }
  const notes = preview.notes.length
    ? `\n\n${preview.notes.join('\n')}`
    : ''
  const write = l10n.t('Write Files')
  const answer = await window.showInformationMessage(`${l10n.t('x18n: write {0}?', preview.files.map(f => f.path).join(', '))}${notes}`, { modal: true }, write)
  if (answer !== write)
    return false
  for (const file of preview.files)
    await workspace.fs.writeFile(Uri.joinPath(folder.uri, file.path), new TextEncoder().encode(file.content))
  void window.showInformationMessage(l10n.t('x18n: migrated {0} from i18n-ally.', folder.name))
  return true
}
