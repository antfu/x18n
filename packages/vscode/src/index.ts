import type { ProjectInfo } from '@x18n/lsp'
import type { Annotations } from './annotations'
import type { X18nClient } from './model/client'
import { methods } from '@x18n/lsp'
import { computed, defineExtension, shallowRef, useActiveTextEditor, useDisposable, useEventEmitter, useStatusBarItem, watch } from 'reactive-vscode'
import { StatusBarAlignment, window, workspace } from 'vscode'
import { State } from 'vscode-languageclient/node'
import { useAnnotations } from './annotations'
import { createClient } from './client'
import { useCommands } from './commands'
import { annotationInPlace, config } from './config'
import { useDisplayLocale } from './display-locale'
import { commands, version } from './generated/meta'
import { useLanguage } from './language'
import { createLog, useLog } from './log'
import { migratableFolders, migrate } from './migrate'
import { projectFor } from './model/client'
import { l10n } from './model/l10n'
import { useUiPanel } from './panel'
import { useReviews } from './reviews'
import { registerNativePreviewMiddleware } from './typescript-native'
import { useViews } from './views'

/** Returned from `activate`; the e2e suite reads in-place state through it. */
export interface X18nExtensionApi {
  readonly inPlace: Annotations['inPlace']
}

const { activate, deactivate } = defineExtension((context): X18nExtensionApi => {
  // Fired when views and annotations must reload: server (re)start, `x18n/changed`, display locale or language switch.
  const refresh = useEventEmitter<void>()
  // Every `l10n.t` of the extension follows `x18n.language`, or the editor's display language when it is empty.
  useLanguage(context.extensionPath, () => refresh.fire())
  // The client's middleware calls into annotations and commands, which in turn need the client.
  let annotations: Annotations | undefined
  let extractAtCursor = async (): Promise<void> => {}
  const displayLocale = useDisplayLocale(context.workspaceState)
  const client = createClient(context, {
    decorations: uri => annotations?.decorations(uri) ?? Promise.resolve([]),
    extractAtCursor: () => extractAtCursor(),
    displayLocale: () => displayLocale.effective.value,
  })
  const x18n: X18nClient = {
    request: async (method, params) => {
      if (!client.isRunning())
        throw new Error('the language server is not running')
      return client.sendRequest(method, params)
    },
  }
  const log = createLog(client)
  const folders = workspace.workspaceFolders?.map(f => f.name) ?? []
  log(`x18n ${version} activated${folders.length
    ? ` in ${folders.join(', ')}`
    : ' without a workspace folder'}.`)
  useLog(client, x18n, refresh.event, log)
  annotations = useAnnotations(x18n, refresh.event)
  useViews(x18n, refresh.event)
  const panel = useUiPanel(x18n)
  const actions = useCommands({
    client,
    x18n,
    openUi: panel.open,
    displayLocale,
  })
  extractAtCursor = actions.extractAtCursor
  useReviews(x18n, actions.execute, refresh.event)

  registerNativePreviewMiddleware(x18n).forEach(useDisposable)
  useDisposable(client.onNotification(methods.changed, () => refresh.fire()))
  useDisposable(client.onDidChangeState(({ newState }) => {
    if (newState === State.Running)
      refresh.fire()
  }))
  useDisposable({
    dispose: () => void client.stop(),
  })

  watch(() => config.enabled, async (enabled) => {
    if (!enabled) {
      log('Disabled by the `x18n.enabled` setting; stopping the language server.')
      await client.stop()
      return
    }
    try {
      await client.start()
    }
    catch (error) {
      log(`The language server failed to start: ${error instanceof Error
        ? error.message
        : String(error)}`)
      return
    }
    void offerMigration()
  }, { immediate: true })
  watch(() => [config.annotationMaxLength, config.codeLens, config.showFlags], () => {
    if (!client.isRunning())
      return
    log('Annotation settings changed; restarting the language server.')
    void client.restart()
  })
  watch(() => [
    displayLocale.effective.value,
    config.annotations,
    annotationInPlace(),
  ], () => {
    if (!client.isRunning())
      return
    const locale = displayLocale.effective.value
    log(`Display locale: ${locale || 'default'}${displayLocale.picked.value === undefined
      ? ''
      : ' (picked in this workspace)'}.`)
    // Re-sending the locale also makes the server refresh inlay hints, which the in-place switch filters.
    void client.sendNotification(methods.setDisplayLocale, { locale: locale || undefined })
    refresh.fire()
  })

  // Status bar: display locale of the active file's project.
  const projects = shallowRef<ProjectInfo[]>([])
  useDisposable(refresh.event(() => void x18n.request('x18n/projects', undefined).then(list => projects.value = list, () => projects.value = [])))
  const editor = useActiveTextEditor()
  const current = computed(() => {
    const path = editor.value?.document.uri.fsPath
    return (path === undefined
      ? undefined
      : projectFor(projects.value, path)) ?? projects.value[0]
  })
  const status = useStatusBarItem({
    id: 'x18n.displayLocale',
    alignment: StatusBarAlignment.Right,
    text: () => {
      const locale = current.value?.displayLocale ?? ''
      const flag = config.showFlags
        ? current.value?.locales.find(l => l.code === locale)?.flag
        : undefined
      return `${flag ?? '$(globe)'} ${locale}`
    },
    // Reads `x18n.language` so the tooltip follows a language switch.
    tooltip: () => config.language === undefined
      ? ''
      : l10n.t('x18n display locale'),
    command: commands.setDisplayLocale,
  })
  watch(current, value => value
    ? status.show()
    : status.hide(), { immediate: true })

  async function offerMigration(): Promise<void> {
    const [folder] = await migratableFolders()
    const action = l10n.t('Migrate from i18n-ally')
    if (folder && await window.showInformationMessage(l10n.t('x18n: {0} has i18n-ally settings and no x18n config.', folder.name), action) === action && await migrate(client, folder))
      await client.restart()
  }

  return { inPlace: annotations.inPlace }
})

export { activate, deactivate }
