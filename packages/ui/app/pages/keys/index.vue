<script setup lang="ts">
import type { MessageState } from '@x18n/core'
import type { KeyRow } from '../../../src/node/types'
import { refDebounced, useVirtualList } from '@vueuse/core'
import { fuzzyScore } from '@x18n/core'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from '#imports'
import LocaleFlag from '../../components/LocaleFlag.vue'
import MessageText from '../../components/MessageText.vue'
import UiSegmented from '../../components/ui/UiSegmented.vue'
import UiToggle from '../../components/ui/UiToggle.vue'
import { describeProblem, setMessage } from '../../edit'
import { t } from '../../i18n'
import { messageStates, reviewStates } from '../../review'
import { backend, currentProject, useLive, visibleLocales } from '../../state'

const ROW_HEIGHT = 32

const route = useRoute()
const router = useRouter()
const table = useLive((b, project) => b.keys(project))

const search = ref('')
// Each keystroke would otherwise score every value of every locale.
const query = refDebounced(computed(() => search.value.trim()), 120)
const namespace = ref('')
const missingIn = ref(typeof route.query.missing === 'string'
  ? route.query.missing
  : '')
const unusedOnly = ref(false)
const withDiagnostics = ref(false)
const outdatedOnly = ref(route.query.outdated !== undefined)
const reviewedOnly = ref(route.query.reviewed !== undefined)
const isState = (value: unknown): value is MessageState => typeof value === 'string' && value in messageStates
const stateFilter = ref<MessageState | ''>(isState(route.query.state)
  ? route.query.state
  : '')
const nameOf = (row: KeyRow): string => row.label ?? row.key
const sort = ref<'key' | 'recent'>('key')
const sorts = computed(() => [
  {
    value: 'key' as const,
    label: t('keys.sortKey'),
  },
  {
    value: 'recent' as const,
    label: t('keys.sortRecent'),
  },
])

// What the toolbar offers, found in one pass over the table instead of one per control.
const facets = computed(() => {
  const out = {
    reviews: false,
    states: false,
    labels: false,
    history: false,
    namespaces: new Set<string>(),
  }
  for (const row of table.value?.rows ?? []) {
    out.reviews ||= Object.keys(row.reviews).length > 0
    out.states ||= Object.keys(row.states).length > 0
    out.labels ||= row.label !== undefined
    out.history ||= row.changedAt !== undefined
    if (row.namespace !== undefined)
      out.namespaces.add(row.namespace)
  }
  return out
})
const hasReviews = computed(() => facets.value.reviews)
const hasStates = computed(() => facets.value.states)
const hasLabels = computed(() => facets.value.labels)
const hasHistory = computed(() => facets.value.history)

const locales = computed(() => visibleLocales.value.map(l => l.code))
const namespaces = computed(() => [
  ...facets.value.namespaces,
].sort())

// Lowercased search text per row, built once per table rather than on every keystroke.
const haystacks = computed(() => new Map((table.value?.rows ?? []).map(row => [
  row,
  {
    key: row.key.toLowerCase(),
    label: row.label?.toLowerCase(),
    values: Object.values(row.values).map(v => String(v).toLowerCase()),
  },
])))

const filtered = computed<KeyRow[]>(() => (table.value?.rows ?? []).filter(row =>
  (!namespace.value || row.namespace === namespace.value)
  && (!missingIn.value || !locales.value.includes(missingIn.value) || row.missing.includes(missingIn.value))
  && (!unusedOnly.value || row.unused)
  && (!withDiagnostics.value || row.diagnostics > 0)
  && (!outdatedOnly.value || row.outdated.some(locale => locales.value.includes(locale)))
  && (!reviewedOnly.value || locales.value.some(locale => row.reviews[locale] !== undefined))
  && (!stateFilter.value || locales.value.some(locale => row.states[locale] === stateFilter.value))))

// The last search, so typing more letters only rescores the rows that already matched:
// a row that does not match a query cannot match the query extended.
let previous: { query: string, from: readonly KeyRow[], matched: Set<KeyRow> } | undefined

function score(row: KeyRow, q: string): number {
  const text = haystacks.value.get(row)
  if (!text)
    return -1
  let best = fuzzyScore(q, text.key)
  if (text.label !== undefined)
    best = Math.max(best, fuzzyScore(q, text.label))
  for (const value of text.values)
    best = Math.max(best, fuzzyScore(q, value) / 2)
  return best
}

const rows = computed<KeyRow[]>(() => {
  const q = query.value.toLowerCase()
  const candidates = filtered.value
  if (!q) {
    previous = undefined
    if (sort.value === 'recent')
      return [...candidates].sort((a, b) => (b.changedAt ?? 0) - (a.changedAt ?? 0))
    return hasLabels.value
      ? [...candidates].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
      : candidates
  }
  const narrowing = previous !== undefined && previous.from === candidates && q.startsWith(previous.query)
  const pool = narrowing
    ? candidates.filter(row => previous!.matched.has(row))
    : candidates
  const scored: { row: KeyRow, score: number }[] = []
  for (const row of pool) {
    const s = score(row, q)
    if (s >= 0)
      scored.push({ row, score: s })
  }
  previous = {
    query: q,
    from: candidates,
    matched: new Set(scored.map(s => s.row)),
  }
  return scored.sort((a, b) => b.score - a.score).map(s => s.row)
})

const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(rows, { itemHeight: ROW_HEIGHT, overscan: 12 })

// Spreadsheet-like cursor: column 0 is the key, then one column per locale.
const active = ref({ row: 0, col: 0 })
const editing = ref<{ key: string, locale: string, draft: string }>()
const problem = ref<{ key: string, locale: string, value: string, message: string }>()
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
const editor = useTemplateRef<HTMLInputElement[]>('editor')

watch(rows, () => {
  active.value = {
    row: Math.min(active.value.row, Math.max(rows.value.length - 1, 0)),
    col: active.value.col,
  }
})

const columns = computed(() => locales.value.length
  ? `minmax(16rem, 1.2fr) repeat(${locales.value.length}, minmax(12rem, 1fr))`
  : '1fr')

function move(row: number, col: number): void {
  const next = {
    row: Math.max(0, Math.min(rows.value.length - 1, row)),
    col: Math.max(0, Math.min(locales.value.length, col)),
  }
  active.value = next
  const el = containerProps.ref.value
  if (el) {
    const top = next.row * ROW_HEIGHT
    if (top < el.scrollTop || top + ROW_HEIGHT * 2 > el.scrollTop + el.clientHeight)
      scrollTo(next.row)
  }
}

async function startEdit(row: KeyRow, locale: string): Promise<void> {
  if (!backend.value?.capabilities.write)
    return
  const value = row.values[locale]
  editing.value = {
    key: row.key,
    locale,
    draft: value === undefined || value === null
      ? ''
      : String(value),
  }
  await nextTick()
  editor.value?.[0]?.focus()
}

async function commit(force = false): Promise<void> {
  const edit = editing.value
  if (!edit)
    return
  editing.value = undefined
  const result = await setMessage(edit.key, edit.locale, edit.draft, force)
  problem.value = result.applied
    ? undefined
    : {
        key: edit.key,
        locale: edit.locale,
        value: edit.draft,
        message: result.problems.map(describeProblem).join('; '),
      }
  containerProps.ref.value?.focus()
}

function cancel(): void {
  editing.value = undefined
  containerProps.ref.value?.focus()
}

async function forceSave(): Promise<void> {
  const p = problem.value
  if (!p)
    return
  editing.value = { key: p.key, locale: p.locale, draft: p.value }
  await commit(true)
}

function open(row: KeyRow): void {
  void router.push(`/keys/${encodeURIComponent(row.key)}`)
}

function activate(): void {
  const row = rows.value[active.value.row]
  if (!row)
    return
  const locale = locales.value[active.value.col - 1]
  if (locale)
    void startEdit(row, locale)
  else
    open(row)
}

const keymap: Record<string, () => void> = {
  'ArrowDown': () => move(active.value.row + 1, active.value.col),
  'ArrowUp': () => move(active.value.row - 1, active.value.col),
  'ArrowRight': () => move(active.value.row, active.value.col + 1),
  'ArrowLeft': () => move(active.value.row, active.value.col - 1),
  'PageDown': () => move(active.value.row + 20, active.value.col),
  'PageUp': () => move(active.value.row - 20, active.value.col),
  'Home': () => move(0, active.value.col),
  'End': () => move(rows.value.length - 1, active.value.col),
  'Enter': activate,
  'F2': activate,
  'o': () => rows.value[active.value.row] && open(rows.value[active.value.row]!),
  'j': () => move(active.value.row + 1, active.value.col),
  'k': () => move(active.value.row - 1, active.value.col),
  '/': () => searchInput.value?.focus(),
}

function onKey(event: KeyboardEvent): void {
  if (editing.value || event.metaKey || event.ctrlKey || event.altKey)
    return
  const action = keymap[event.key]
  if (action) {
    event.preventDefault()
    action()
  }
}

function onEditorKey(event: KeyboardEvent): void {
  // The grid's own keymap must not see keys typed into the editor.
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
  else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    void commit().then(() => {
      if (event.key === 'Tab')
        move(active.value.row, active.value.col + 1)
    })
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="shrink-0 flex flex-wrap items-center gap-3 border-b border-base px-4 py-2">
      <label class="input w-80 flex items-center gap-2 focus-within:border-inverse">
        <span class="i-ph-magnifying-glass-duotone color-faint" />
        <input ref="searchInput" v-model="search" class="flex-auto bg-transparent outline-none" :placeholder="t('keys.search')" :aria-label="t('keys.search')" @keydown.escape="containerProps.ref.value?.focus()" @keydown.enter="containerProps.ref.value?.focus()">
        <kbd class="badge">/</kbd>
      </label>
      <select v-if="namespaces.length" v-model="namespace" class="input text-xs" :aria-label="t('keys.namespace')">
        <option value="">
          {{ t('keys.allNamespaces') }}
        </option>
        <option v-for="ns in namespaces" :key="ns" :value="ns">
          {{ ns }}
        </option>
      </select>
      <select v-model="missingIn" class="input text-xs" :aria-label="t('keys.missingIn')">
        <option value="">
          {{ t('keys.anyLocale') }}
        </option>
        <option v-for="locale in locales" :key="locale" :value="locale">
          {{ t('keys.missingInLocale', { locale }) }}
        </option>
      </select>
      <UiToggle v-model="unusedOnly">
        {{ t('keys.unused') }}
      </UiToggle>
      <UiToggle v-model="withDiagnostics">
        {{ t('keys.withDiagnostics') }}
      </UiToggle>
      <UiToggle v-if="hasReviews" v-model="reviewedOnly">
        {{ t('keys.reviewed') }}
      </UiToggle>
      <select v-if="hasStates" v-model="stateFilter" class="input text-xs" :aria-label="t('state.filter')">
        <option value="">
          {{ t('state.any') }}
        </option>
        <option v-for="(info, state) in messageStates" :key="state" :value="state">
          {{ t(info.label) }}
        </option>
      </select>
      <template v-if="hasHistory">
        <UiToggle v-model="outdatedOnly">
          {{ t('keys.outdated') }}
        </UiToggle>
        <UiSegmented v-model="sort" :options="sorts" :label="t('keys.sort')" />
      </template>
      <div class="flex-auto" />
      <span class="font-mono text-xs color-muted tabular-nums">{{ t('keys.count', { shown: rows.length, total: table?.rows.length ?? 0 }) }}</span>
    </div>

    <div v-if="problem" class="shrink-0 flex items-center gap-2 border-b border-base px-4 py-1.5 color-warn" role="alert">
      <span class="i-ph-warning-duotone" />
      <span class="color-base">{{ t('edit.rejected', { key: problem.key, locale: problem.locale, message: problem.message }) }}</span>
      <button class="btn-outline h-7" @click="forceSave">
        {{ t('edit.saveAnyway') }}
      </button>
      <button class="btn-ghost h-7" @click="problem = undefined">
        {{ t('edit.dismiss') }}
      </button>
    </div>

    <div
      v-bind="containerProps"
      class="flex-auto min-h-0 of-auto outline-none"
      tabindex="0"
      role="grid"
      :aria-label="t('keys.grid')"
      :aria-rowcount="rows.length"
      @keydown="onKey"
    >
      <div class="sticky top-0 z-20 grid border-b border-strong bg-base" :style="{ gridTemplateColumns: columns, height: `${ROW_HEIGHT}px` }" role="row">
        <div class="label flex items-center px-4" role="columnheader">
          {{ t('keys.key') }}
        </div>
        <div v-for="locale in locales" :key="locale" class="flex items-center gap-2 border-l border-base px-3" role="columnheader">
          <LocaleFlag :code="locale" />
          <span class="label color-base">{{ locale }}</span>
          <span v-if="locale === currentProject?.sourceLocale" class="badge">{{ t('overview.source') }}</span>
        </div>
      </div>
      <div v-bind="wrapperProps">
        <div
          v-for="{ data: row, index } in list"
          :key="row.key"
          class="grid border-b border-base"
          :class="index === active.row ? 'bg-hover' : ''"
          :style="{ gridTemplateColumns: columns, height: `${ROW_HEIGHT}px` }"
          role="row"
          :aria-rowindex="index + 1"
          :data-key="row.key"
        >
          <div
            class="flex min-w-0 cursor-pointer items-center gap-1.5 px-4 font-mono text-xs"
            :class="index === active.row && active.col === 0 ? 'outline outline-1 outline-[var(--x-fg)] -outline-offset-1' : ''"
            role="gridcell"
            :title="row.label === undefined ? row.key : `${row.label}\n${row.key}`"
            @click="move(index, 0)"
            @dblclick="open(row)"
          >
            <span class="truncate">{{ nameOf(row) }}</span>
            <span v-if="row.unused" class="i-ph-ghost-duotone shrink-0 color-faint" :title="t('keys.unusedHint')" />
            <span v-if="row.diagnostics" class="badge shrink-0 border-current color-error" :title="t('keys.diagnosticsHint')">{{ row.diagnostics }}</span>
          </div>
          <div
            v-for="(locale, col) in locales"
            :key="locale"
            class="flex min-w-0 items-center border-l border-base px-3"
            :class="index === active.row && active.col === col + 1 ? 'outline outline-1 outline-[var(--x-fg)] -outline-offset-1' : ''"
            role="gridcell"
            :data-locale="locale"
            @click="move(index, col + 1)"
            @dblclick="startEdit(row, locale)"
          >
            <input
              v-if="editing && editing.key === row.key && editing.locale === locale"
              ref="editor"
              v-model="editing.draft"
              class="w-full bg-transparent outline-none"
              :aria-label="t('keys.editValue', { key: row.key, locale })"
              @keydown="onEditorKey"
              @blur="commit()"
            >
            <template v-else>
              <span class="truncate" :title="String(row.values[locale] ?? '')"><MessageText :value="row.values[locale]" inline /></span>
              <span class="ml-auto flex shrink-0 gap-2 pl-2 empty:hidden">
                <span v-if="row.states[locale]" :class="messageStates[row.states[locale]].color" :title="t(messageStates[row.states[locale]].label)"><span class="block" :class="messageStates[row.states[locale]].icon" /></span>
                <span v-if="row.reviews[locale]" :class="reviewStates[row.reviews[locale]].color" :title="t(reviewStates[row.reviews[locale]].label)"><span class="block" :class="reviewStates[row.reviews[locale]].icon" /></span>
                <span v-if="row.outdated.includes(locale)" class="color-warn" :title="t('history.outdatedHint')"><span class="i-ph-clock-counter-clockwise-duotone block" /></span>
              </span>
            </template>
          </div>
        </div>
      </div>
      <p v-if="table && !rows.length" class="p-4 color-muted">
        {{ t('keys.empty') }}
      </p>
    </div>

    <div class="shrink-0 flex gap-4 border-t border-base px-4 py-1.5 font-mono text-[11px] color-muted">
      <span>{{ t('keys.helpMove') }}</span>
      <span v-if="backend?.capabilities.write">{{ t('keys.helpEdit') }}</span>
      <span>{{ t('keys.helpOpen') }}</span>
      <span>{{ t('keys.helpSearch') }}</span>
    </div>
  </div>
</template>
