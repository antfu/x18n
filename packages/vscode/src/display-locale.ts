import type { ComputedRef } from 'reactive-vscode'
import type { Memento } from 'vscode'
import { computed, shallowRef, useDisposable } from 'reactive-vscode'
import { workspace } from 'vscode'
import { config } from './config'
import { displayLocalePick, effectiveDisplayLocale } from './model/display-locale'

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
 * in `.vscode/settings.json`, which is often committed. Editing `x18n.displayLocale` clears the pick.
 */
export function useDisplayLocale(state: Memento): DisplayLocale {
  const store = displayLocalePick(state)
  const picked = shallowRef(store.current())
  const sync = (): void => {
    picked.value = store.current()
  }
  useDisposable(workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('x18n.displayLocale'))
      void store.settingChanged().finally(sync)
  }))
  return {
    effective: computed(() => effectiveDisplayLocale(picked.value, config.displayLocale)),
    picked: computed(() => picked.value),
    pick: async (locale) => {
      await store.pick(locale).finally(sync)
    },
  }
}
