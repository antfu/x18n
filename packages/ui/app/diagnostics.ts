import type { WireDiagnostic } from '@x18n/core'
import type { ComputedRef, ShallowRef } from 'vue'
import type { DiagnosticCount, DiagnosticQuery } from '../src/node/types'
import { computed, ref, shallowRef, watchEffect } from 'vue'
import { backend, projectName, revision } from './state'

interface DiagnosticList {
  readonly total: number
  readonly pageSize: number
  readonly byCode: readonly DiagnosticCount[]
  readonly items: readonly WireDiagnostic[]
}

interface Diagnostics {
  /** The pages loaded so far, joined; undefined until the first one arrives. */
  readonly data: ShallowRef<DiagnosticList | undefined>
  readonly hasMore: ComputedRef<boolean>
  /** Loads the next page and appends it; nothing when every page is loaded. */
  readonly more: () => void
}

/**
 * Diagnostics of the current project that match `filter`, a page at a time: the server sends
 * only the pages asked for. Reloads the loaded pages when anything in the project changes.
 */
export function useDiagnostics(filter: () => Omit<DiagnosticQuery, 'project' | 'page'>): Diagnostics {
  const data = shallowRef<DiagnosticList>()
  // Pages wanted, for one filter: a new filter starts again at one page.
  const wanted = ref<{ filter: string, pages: number }>({ filter: '', pages: 1 })
  let loaded: { key: string, pages: number } | undefined
  let latest = 0

  watchEffect(() => {
    const b = backend.value
    const project = projectName.value
    const query = filter()
    const filterKey = JSON.stringify(query)
    const key = `${project}\n${revision.value}\n${filterKey}`
    const pages = wanted.value.filter === filterKey
      ? wanted.value.pages
      : 1
    if (!b || !project)
      return
    // Same data, more pages: fetch only the new ones and append them.
    const from = loaded?.key === key && pages > loaded.pages
      ? loaded.pages
      : 0
    if (loaded?.key === key && pages === loaded.pages)
      return
    const request = ++latest
    void Promise.all(Array.from({ length: pages - from }, (_, i) => b.diagnostics(project, { ...query, page: from + i }))).then((results) => {
      if (request !== latest || !results[0])
        return
      const head = results[0]
      data.value = {
        total: head.total,
        pageSize: head.pageSize,
        byCode: head.byCode,
        items: [
          ...from > 0
            ? data.value?.items ?? []
            : [],
          ...results.flatMap(r => r.items),
        ],
      }
      loaded = { key, pages }
    })
  })

  const hasMore = computed(() => (data.value?.items.length ?? 0) < (data.value?.total ?? 0))
  return {
    data,
    hasMore,
    more() {
      if (!hasMore.value)
        return
      const filterKey = JSON.stringify(filter())
      wanted.value = {
        filter: filterKey,
        pages: (wanted.value.filter === filterKey
          ? wanted.value.pages
          : 1) + 1,
      }
    },
  }
}
