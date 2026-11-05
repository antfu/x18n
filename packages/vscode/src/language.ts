import type { Translate } from './model/l10n'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { watch } from 'reactive-vscode'
import { l10n as vscodeL10n } from 'vscode'
import { config } from './config'
import { bundleTranslator, setTranslator } from './model/l10n'

/** The translator for `x18n.language`: the editor's display language when empty, else that language's bundle. */
function translatorFor(language: string, extensionPath: string): Translate | undefined {
  if (!language)
    return (message, ...args) => vscodeL10n.t(message, ...args)
  if (language === 'en')
    return undefined
  try {
    return bundleTranslator(JSON.parse(readFileSync(join(extensionPath, 'l10n', `bundle.l10n.${language}.json`), 'utf8')))
  }
  catch {
    // An unknown language has no bundle: fall back to the editor's.
    return (message, ...args) => vscodeL10n.t(message, ...args)
  }
}

/**
 * Applies `x18n.language` to every `l10n.t` of the extension, and calls `changed` when it changes so views reload.
 * Command titles and setting descriptions come from `package.nls.*.json`, which VS Code reads in its own language.
 */
export function useLanguage(extensionPath: string, changed: () => void): void {
  watch(() => config.language, (language, previous) => {
    setTranslator(translatorFor(language ?? '', extensionPath))
    if (previous !== undefined)
      changed()
  }, { immediate: true })
}
