/** Workspace-state key of the locale picked with "Set Display Locale". */
export const displayLocaleKey = 'x18n.displayLocale'

/**
 * The display locale in effect: the locale picked in this workspace, else the `x18n.displayLocale` setting.
 * An empty string means the source locale, both as a pick and as a setting; `undefined` means nothing was picked.
 */
export function effectiveDisplayLocale(picked: string | undefined, setting: string): string {
  return picked ?? setting
}

/** The part of a VS Code `Memento` the pick needs. */
export interface PickState {
  get: <T>(key: string) => T | undefined
  update: (key: string, value: unknown) => PromiseLike<void>
}

export interface DisplayLocalePick {
  /** The locale picked in this workspace, `undefined` when the setting applies. */
  readonly current: () => string | undefined
  /** Stores a pick, or clears it with `undefined`. */
  readonly pick: (locale: string | undefined) => Promise<void>
  /** Clears the pick, so an edited `x18n.displayLocale` takes effect. */
  readonly settingChanged: () => Promise<void>
}

export function displayLocalePick(state: PickState): DisplayLocalePick {
  let picked = state.get<string>(displayLocaleKey)
  const pick = async (locale: string | undefined): Promise<void> => {
    picked = locale
    await state.update(displayLocaleKey, locale)
  }
  return {
    current: () => picked,
    pick,
    settingChanged: async () => {
      if (picked !== undefined)
        await pick(undefined)
    },
  }
}
