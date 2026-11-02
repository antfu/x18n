import type { ComputedRef } from 'reactive-vscode'
import type { Memento } from 'vscode'
import { computed, shallowRef } from 'reactive-vscode'
import { config } from './config'
import { displayLocaleKey, effectiveDisplayLocale } from './model/display-locale'

export interface DisplayLocale {
  /** Locale shown in annotations; empty means the source locale. */
  readonly effective: ComputedRef<string>
  /** The locale picked in this workspace, `undefined` when the setting applies. */
  readonly picked: ComputedRef<string | undefined>
  /** Stores a pick in the workspace state, or clears it with `undefined`. */
  readonly pick: (locale: string | undefined) => Promise<void>
}

/**
 * The display locale is a personal choice, so the picker keeps it in the extension's workspace state rather than
 * in `.vscode/settings.json`, which is often committed.
 */
export function useDisplayLocale(state: Memento): DisplayLocale {
  const picked = shallowRef(state.get<string>(displayLocaleKey))
  return {
    effective: computed(() => effectiveDisplayLocale(picked.value, config.displayLocale)),
    picked: computed(() => picked.value),
    pick: async (locale) => {
      picked.value = locale
      await state.update(displayLocaleKey, locale)
    },
  }
}
