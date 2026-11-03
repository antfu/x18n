import type { Decoration } from '@x18n/lsp'
import type { ExtensionContext } from 'vscode'
import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node'
import { Uri, workspace } from 'vscode'
import { LanguageClient, TransportKind } from 'vscode-languageclient/node'
import { annotationInPlace, config } from './config'
import { commands, displayName } from './generated/meta'
import { hintCovered } from './model/inplace'
import { findLocalServer } from './model/local-server'
import { dedupeLocations } from './model/locations'
import { stamp } from './model/log'

export interface ClientHooks {
  /** Decorations of a document, for dropping inlay hints that in-place mode already shows. */
  readonly decorations: (uri: string) => Promise<readonly Decoration[]>
  /** Runs `x18n.extract` when invoked without the server's `{ uri }` argument (palette, keybinding). */
  readonly extractAtCursor: () => Promise<void>
  /** Display locale in effect, sent on every (re)start; empty means the source locale. */
  readonly displayLocale: () => string
}

export function createClient(context: ExtensionContext, hooks: ClientHooks): LanguageClient {
  const folder = workspace.workspaceFolders?.[0]?.uri
  // A server installed in the project wins over the bundled one, so the project's own x18n version (and its native parser) is used.
  const local = config.useLocalServer && folder?.scheme === 'file'
    ? findLocalServer(folder.fsPath)
    : undefined
  const module = local ?? Uri.joinPath(context.extensionUri, 'dist', 'server.cjs').fsPath
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
      options: {
        execArgv: ['--nolazy', '--inspect=6009'],
      },
    },
  }
  // Hovers link to these commands; untrusted markdown would not run them.
  const hoverCommands = [commands.openKey, commands.copyTranslatePrompt, commands.translateWithAgent]
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file' },
    ],
    markdown: {
      isTrusted: {
        enabledCommands: hoverCommands,
      },
    },
    // Read on every (re)start, so a restart after a settings change picks up new values.
    initializationOptions: () => ({
      displayLocale: hooks.displayLocale() || undefined,
      annotationMaxLength: config.annotationMaxLength,
      codeLens: config.codeLens,
      showFlags: config.showFlags,
      hoverCommands,
    }),
    middleware: {
      // VS Code merges references from every provider and has no API to read the others' results from inside one
      // provider without recursing into ours, so only our own duplicates (a key both used and defined in one spot) go.
      provideReferences: async (document, position, options, token, next) => {
        const locations = await next(document, position, options, token)
        return locations && dedupeLocations(locations)
      },
      provideInlayHints: async (document, range, token, next) => {
        if (!config.annotations)
          return []
        const hints = await next(document, range, token)
        if (!hints || !annotationInPlace())
          return hints
        const decorations = await hooks.decorations(document.uri.toString())
        return hints.filter(hint => !hintCovered(hint.position, decorations, config.annotationMaxLength))
      },
      // The client registers the server's `x18n.extract` as a VS Code command, so the palette entry lands here too.
      executeCommand: (command, args, next) => command === 'x18n.extract' && args.length === 0
        ? hooks.extractAtCursor()
        : next(command, args),
    },
  }
  const client = new LanguageClient('x18n', displayName, serverOptions, clientOptions)
  client.outputChannel.appendLine(stamp(local
    ? `Using the project's language server: ${local}`
    : 'Using the bundled language server.'))
  return client
}
