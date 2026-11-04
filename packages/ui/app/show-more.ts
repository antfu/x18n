import type { ComputedRef, Ref } from 'vue'
import { computed, ref, watch } from 'vue'

/** Items mounted per step of a long list. */
export const listStep = 200

interface ShowMore<T> {
  readonly shown: ComputedRef<readonly T[]>
  readonly more: () => void
}

/**
 * The first part of a long list, growing on `more`: tens of thousands of rows block the tab.
 * Starts again at one step when `reset` changes (a tab or a filter, not a live reload).
 */
export function useShowMore<T>(list: Ref<readonly T[]>, reset?: () => unknown): ShowMore<T> {
  const limit = ref(listStep)
  if (reset) {
    watch(reset, () => {
      limit.value = listStep
    })
  }
  return {
    shown: computed(() => list.value.length > limit.value
      ? list.value.slice(0, limit.value)
      : list.value),
    more: () => {
      limit.value += listStep
    },
  }
}
