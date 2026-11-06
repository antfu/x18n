/** A message argument, as `vscode.l10n.t` takes them. */
export type L10nArg = string | number | boolean

/** Returns `message` in the editor's display language, with `{0}`-style arguments filled in. */
export type Translate = (message: string, ...args: L10nArg[]) => string

/** Fills `{0}`, `{1}`, ... with `args`; a placeholder without an argument stays as written. */
export function format(message: string, args: readonly L10nArg[]): string {
  return message.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const arg = args[Number(index)]
    return arg === undefined
      ? placeholder
      : String(arg)
  })
}

const english: Translate = (message, ...args) => format(message, args)
let translate = english

/**
 * Translates the extension's user-facing strings. Every `l10n.t` of the extension goes through here, so the
 * `x18n.language` setting can pick a language other than the editor's; the view models also stay independent of the
 * `vscode` API this way. English until the extension sets a translator at activation (see `language.ts`).
 */
export const l10n: { readonly t: Translate } = {
  t: (message, ...args) => translate(message, ...args),
}

/** A translator from a `bundle.l10n.<language>.json` bundle: English message to translation, English when missing. */
export function bundleTranslator(bundle: Readonly<Record<string, string>>): Translate {
  return (message, ...args) => format(bundle[message] || message, args)
}

/** Sets the translator of `l10n.t`; `undefined` restores the English default. */
export function setTranslator(t: Translate | undefined): void {
  translate = t ?? english
}
