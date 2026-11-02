/** Workspace-state key of the locale picked with "Set Display Locale". */
export const displayLocaleKey = 'x18n.displayLocale'

/**
 * The display locale in effect: the locale picked in this workspace, else the `x18n.displayLocale` setting.
 * An empty string means the source locale, both as a pick and as a setting; `undefined` means nothing was picked.
 */
export function effectiveDisplayLocale(picked: string | undefined, setting: string): string {
  return picked ?? setting
}
