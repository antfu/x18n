<script setup lang="ts">
import type { KeyRowItem } from '../key-tree'
import { useLocalStorage, useVirtualList } from '@vueuse/core'
import { fuzzyScore } from '@x18n/core'
import { computed, nextTick, ref, watch } from 'vue'
import { NuxtLink } from '#components'
import { useRoute } from '#imports'
import { t } from '../i18n'
import { folderIds, treeRows } from '../key-tree'
import { useLive } from '../state'

const ROW_HEIGHT = 28

const route = useRoute()
const activeKey = computed(() => String(route.params.key))
const table = useLive((b, project) => b.keys(project))

const view = useLocalStorage<'list' | 'tree'>('x18n:key-view', 'tree')
const filter = ref('')
const open = ref(new Set<string>())

// Opening a key reveals it: its folders open.
watch(activeKey, (key) => {
  open.value = new Set([
    ...open.value,
    ...folderIds(key),
  ])
}, { immediate: true })

const keys = computed(() => table.value?.rows.map(r => r.key) ?? [])
const labels = computed(() => new Map((table.value?.rows ?? []).flatMap(r => r.label === undefined
  ? []
  : [
      [r.key, r.label] as const,
    ])))
const matched = computed(() => {
  const query = filter.value.trim()
  if (!query) {
    return labels.value.size > 0
      ? [...keys.value].sort((a, b) => (labels.value.get(a) ?? a).localeCompare(labels.value.get(b) ?? b))
      : keys.value
  }
  return keys.value.map((key) => {
    const label = labels.value.get(key)
    return {
      key,
      score: Math.max(fuzzyScore(query, key), label === undefined
        ? -1
        : fuzzyScore(query, label)),
    }
  }).filter(m => m.score >= 0).sort((a, b) => b.score - a.score).map(m => m.key)
})
const items = computed<KeyRowItem[]>(() => view.value === 'tree'
  ? treeRows(matched.value, open.value, filter.value.trim() !== '', labels.value)
  : matched.value.map(key => ({
      id: key,
      label: labels.value.get(key) ?? key,
      depth: 0,
      key,
      branch: false,
      open: false,
    })))

const { list, containerProps, wrapperProps } = useVirtualList(items, { itemHeight: ROW_HEIGHT, overscan: 10 })

function toggle(row: KeyRowItem): void {
  const next = new Set(open.value)
  if (!next.delete(row.id))
    next.add(row.id)
  open.value = next
}

/** Scrolls the open key to the middle when it is out of sight. */
async function reveal(): Promise<void> {
  await nextTick()
  const el = containerProps.ref.value
  const index = items.value.findIndex(row => row.key === activeKey.value)
  if (!el || index < 0)
    return
  const top = index * ROW_HEIGHT
  if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
    el.scrollTop = Math.max(0, top - el.clientHeight / 2)
}

watch([
  activeKey,
  view,
  () => table.value?.rows.length,
], reveal, { flush: 'post' })
</script>

<template>
  <div class="min-h-0 flex flex-auto flex-col">
    <div class="flex items-center gap-2 border-b border-base px-3 py-2">
      <span class="label">{{ t('nav.keys') }}</span>
      <span class="font-mono text-xs color-faint tabular-nums">{{ keys.length }}</span>
      <span class="flex-auto" />
      <div class="flex" role="group" :aria-label="t('sidebar.view')">
        <button type="button" class="btn-icon h-6 w-6 text-sm" :class="view === 'list' && 'bg-hover color-base'" :aria-pressed="view === 'list'" :title="t('sidebar.list')" :aria-label="t('sidebar.list')" @click="view = 'list'">
          <span class="i-ph-list-bullets-duotone" />
        </button>
        <button type="button" class="btn-icon h-6 w-6 text-sm" :class="view === 'tree' && 'bg-hover color-base'" :aria-pressed="view === 'tree'" :title="t('sidebar.tree')" :aria-label="t('sidebar.tree')" @click="view = 'tree'">
          <span class="i-ph-tree-structure-duotone" />
        </button>
      </div>
    </div>
    <div class="border-b border-base px-3 py-2">
      <input v-model="filter" class="input h-7 w-full font-mono text-xs" type="search" :placeholder="t('sidebar.filter')" :aria-label="t('sidebar.filter')">
    </div>
    <div v-bind="containerProps" class="min-h-0 flex-auto">
      <div v-bind="wrapperProps">
        <div
          v-for="{ data: row } in list"
          :key="row.id"
          class="h-7 flex items-center pr-2 font-mono text-xs transition-colors hover:bg-hover"
          :class="row.key === activeKey ? 'bg-hover color-base shadow-[inset_2px_0_var(--x-fg)]' : 'color-muted'"
          :style="{ paddingLeft: `${8 + row.depth * 12}px` }"
        >
          <template v-if="view === 'tree'">
            <button v-if="row.branch" type="button" class="focus-ring size-4 flex shrink-0 items-center justify-center" :aria-expanded="row.open" :aria-label="row.label" @click="toggle(row)">
              <span class="i-ph-caret-right-duotone transition-transform" :class="row.open && 'rotate-90'" />
            </button>
            <span v-else class="size-4 shrink-0" />
          </template>
          <NuxtLink v-if="row.key" :to="`/keys/${encodeURIComponent(row.key)}`" class="focus-ring ml-1 min-w-0 flex-auto truncate" :aria-current="row.key === activeKey ? 'page' : undefined" :title="row.key">
            {{ row.label }}
          </NuxtLink>
          <button v-else type="button" class="focus-ring ml-1 min-w-0 flex-auto truncate text-left" @click="toggle(row)">
            {{ row.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
