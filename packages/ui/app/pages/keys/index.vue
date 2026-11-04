<script setup lang="ts">
import type { Fix, MessageLeaf, MessageState, ReviewType } from '@x18n/core'
import type { KeyDetail, KeyRow, UiEditOp } from '../../../src/node/types'
import type { MenuItem, MenuPosition } from '../../menu'
import { onClickOutside, refDebounced, useVirtualList } from '@vueuse/core'
import { fuzzyScore } from '@x18n/core'
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from '#imports'
import ContextMenu from '../../components/ContextMenu.vue'
import LocaleFlag from '../../components/LocaleFlag.vue'
import MessageText from '../../components/MessageText.vue'
import ReviewComposer from '../../components/ReviewComposer.vue'
import UiSegmented from '../../components/ui/UiSegmented.vue'
import UiToggle from '../../components/ui/UiToggle.vue'
import { applyEdit, describeProblem, setMessage } from '../../edit'
import { t } from '../../i18n'
import { translatePrompt } from '../../prompt'
import { messageStates, reviewStates } from '../../review'
import { backend, currentProject, projectName, useLive, visibleLocales } from '../../state'

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
const renaming = ref<{ key: string, draft: string }>()
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
const editor = useTemplateRef<HTMLInputElement[]>('editor')

// A key to put the cursor on once it shows up, after a rename.
let follow: string | undefined

watch(rows, () => {
  const found = follow === undefined
    ? -1
    : rows.value.findIndex(row => row.key === follow)
  if (found >= 0) {
    follow = undefined
    move(found, active.value.col)
    return
  }
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
  'r': () => rows.value[active.value.row] && startRename(rows.value[active.value.row]!),
}

function onKey(event: KeyboardEvent): void {
  if (editing.value || renaming.value || event.metaKey || event.ctrlKey || event.altKey)
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

// ---- Context menu ----

const canWrite = computed(() => backend.value?.capabilities.write === true)
const canReview = computed(() => canWrite.value && currentProject.value?.reviews !== undefined)
const menu = shallowRef<{ at: MenuPosition, row: KeyRow, locale: string | undefined }>()
// The key's diagnostics and files, loaded when the menu opens; undefined while loading.
const menuDetail = shallowRef<KeyDetail | null>()
const failure = ref<string>()
const renameInput = useTemplateRef<HTMLInputElement[]>('renameInput')
const reviewing = shallowRef<{ at: MenuPosition, key: string, locale: string, current: MessageLeaf | undefined, type: ReviewType }>()
const reviewPanel = useTemplateRef<HTMLElement>('reviewPanel')

onClickOutside(reviewPanel, () => closeReview())

function onContextMenu(event: MouseEvent): void {
  const target = event.target as HTMLElement
  // Editors keep the browser's menu, for cut and paste.
  if (target.closest('input'))
    return
  const cell = target.closest<HTMLElement>('[data-col]')
  const row = cell?.closest<HTMLElement>('[data-row]')
  event.preventDefault()
  if (cell && row) {
    openMenu(Number(row.dataset.row), Number(cell.dataset.col), { x: event.clientX, y: event.clientY })
    return
  }
  // The context menu key and Shift+F10 target the grid itself: open at the cursor cell.
  const current = containerProps.ref.value?.querySelector<HTMLElement>(`[data-row="${active.value.row}"] [data-col="${active.value.col}"]`)
  if (!current)
    return
  const rect = current.getBoundingClientRect()
  openMenu(active.value.row, active.value.col, { x: rect.left + 8, y: rect.bottom })
}

function openMenu(index: number, col: number, at: MenuPosition): void {
  const row = rows.value[index]
  const b = backend.value
  if (!row || !b || !projectName.value)
    return
  move(index, col)
  menu.value = { at, row, locale: locales.value[col - 1] }
  menuDetail.value = undefined
  void b.key(projectName.value, row.key).then((detail) => {
    if (menu.value?.row === row)
      menuDetail.value = detail
  }, () => {
    if (menu.value?.row === row)
      menuDetail.value = null
  })
}

function closeMenu(): void {
  menu.value = undefined
  if (!renaming.value && !reviewing.value && !editing.value)
    containerProps.ref.value?.focus()
}

async function run(ops: readonly UiEditOp[]): Promise<void> {
  failure.value = undefined
  try {
    const result = await applyEdit(ops)
    if (!result.applied) {
      failure.value = t('menu.failed', {
        message: result.problems.map(describeProblem).join('; '),
      })
    }
  }
  catch (error) {
    failure.value = t('menu.failed', {
      message: error instanceof Error
        ? error.message
        : String(error),
    })
  }
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text)
}

function isUiOp(op: Fix['ops'][number]): op is UiEditOp {
  return op.type !== 'extract' && op.type !== 'format'
}

/** The locales a fix writes to; empty when its ops do not name one. */
function fixLocales(fix: Fix): string[] {
  return fix.ops.flatMap(op => 'locale' in op && typeof op.locale === 'string'
    ? [op.locale]
    : 'locales' in op && Array.isArray(op.locales)
      ? op.locales
      : [])
}

/** Whether a fix belongs on a cell: every fix on the key cell, those that write to its locale on a value cell. */
function fixFits(fix: Fix, reported: string | undefined, locale: string | undefined): boolean {
  if (locale === undefined)
    return true
  const targets = fixLocales(fix)
  return targets.length
    ? targets.includes(locale)
    : reported === locale
}

/**
 * The fixes of the key's diagnostics, of one locale when given; the same fix offered twice shows once.
 * A value cell shows the fixes that write to its locale, wherever the diagnostic was reported: a missing translation
 * is reported on the source message but fixed in the target locale.
 */
function fixItems(row: KeyRow, locale: string | undefined): MenuItem[] {
  if (!canWrite.value || (row.diagnostics === 0 && !menuDetail.value?.diagnostics.length))
    return []
  const detail = menuDetail.value
  if (detail === undefined) {
    return [
      { separator: true },
      {
        label: t('menu.loadingFixes'),
        icon: 'i-ph-circle-notch animate-spin',
        disabled: true,
        action: () => {},
      },
    ]
  }
  const seen = new Set<string>()
  const items: MenuItem[] = []
  for (const d of detail?.diagnostics ?? []) {
    for (const fix of d.fixes) {
      const id = JSON.stringify(fix.ops)
      if (!fix.ops.every(isUiOp) || seen.has(id) || !fixFits(fix, d.locale, locale))
        continue
      seen.add(id)
      items.push({
        label: fix.title,
        icon: d.severity === 'error'
          ? 'i-ph-wrench-duotone color-error'
          : 'i-ph-wrench-duotone color-warn',
        hint: locale === undefined
          ? fixLocales(fix).join(', ') || d.locale
          : undefined,
        action: () => run(fix.ops.filter(isUiOp)),
      })
    }
  }
  return items.length
    ? [
        { separator: true },
        {
          heading: t('menu.fixes'),
        },
        ...items,
      ]
    : []
}

function keyItems(row: KeyRow): MenuItem[] {
  return [
    {
      label: t('menu.open'),
      icon: 'i-ph-arrow-square-in-duotone',
      hint: 'o',
      action: () => open(row),
    },
    ...canWrite.value
      ? [
          {
            label: t('menu.rename'),
            icon: 'i-ph-pencil-simple-line-duotone',
            hint: 'r',
            action: () => startRename(row),
          },
        ]
      : [],
    {
      label: t('menu.copyKey'),
      icon: 'i-ph-copy-duotone',
      action: () => copy(row.key),
    },
    ...fixItems(row, undefined),
    ...canWrite.value
      ? [
          { separator: true } as const,
          {
            label: t('menu.deleteKey'),
            icon: 'i-ph-trash-duotone',
            danger: true,
            confirm: t('menu.confirm'),
            action: () => run([
              { type: 'delete', key: row.key, locales: 'all' },
            ]),
          },
        ]
      : [],
  ]
}

function valueItems(row: KeyRow, locale: string): MenuItem[] {
  const value = row.values[locale]
  const has = value !== undefined
  const message = menuDetail.value?.messages.find(m => m.locale === locale)
  const review = (type: ReviewType) => () => openReview(row, locale, type)
  const items: MenuItem[] = []
  if (canWrite.value) {
    items.push({
      label: t('menu.edit'),
      icon: 'i-ph-pencil-simple-duotone',
      hint: 'Enter',
      action: () => startEdit(row, locale),
    })
  }
  items.push({
    label: t('menu.copyValue'),
    icon: 'i-ph-copy-duotone',
    disabled: !has,
    action: () => copy(String(value ?? '')),
  })
  if (backend.value?.capabilities.prompts && locale !== currentProject.value?.sourceLocale) {
    items.push({
      label: t('menu.copyPrompt'),
      icon: 'i-ph-sparkle-duotone',
      action: () => copy(translatePrompt([
        { locale, key: row.key },
      ])),
    })
  }
  if (backend.value?.capabilities.openInEditor) {
    items.push({
      label: t('menu.openFile'),
      icon: 'i-ph-file-text-duotone',
      disabled: !message,
      action: () => message && backend.value?.openInEditor({
        project: projectName.value,
        path: message.path,
        line: message.line,
        column: 1,
      }),
    })
  }
  if (canReview.value) {
    items.push(
      { separator: true },
      {
        heading: t('menu.review'),
      },
      {
        label: t('review.types.approve'),
        icon: 'i-ph-check-circle-duotone color-ok',
        disabled: !has,
        action: () => run([
          {
            type: 'review',
            key: row.key,
            locale,
            review: 'approve',
          },
        ]),
      },
      {
        label: t('menu.comment'),
        icon: 'i-ph-chat-circle-text-duotone',
        action: review('comment'),
      },
      {
        label: t('menu.requestChange'),
        icon: 'i-ph-note-pencil-duotone color-warn',
        action: review('request-change'),
      },
      {
        label: t('menu.suggest'),
        icon: 'i-ph-lightbulb-duotone color-info',
        action: review('suggestion'),
      },
    )
  }
  if (canWrite.value && row.outdated.includes(locale)) {
    items.push({ separator: true }, {
      label: t('menu.markFresh'),
      icon: 'i-ph-clock-clockwise-duotone',
      action: () => run([
        {
          type: 'mark-fresh',
          key: row.key,
          locales: [locale],
        },
      ]),
    })
  }
  items.push(...fixItems(row, locale))
  if (canWrite.value && has) {
    items.push({ separator: true }, {
      label: t('menu.deleteValue', { locale }),
      icon: 'i-ph-trash-duotone',
      danger: true,
      confirm: t('menu.confirm'),
      action: () => run([
        {
          type: 'delete',
          key: row.key,
          locales: [locale],
        },
      ]),
    })
  }
  return items
}

const menuItems = computed<MenuItem[]>(() => {
  const m = menu.value
  if (!m)
    return []
  return m.locale === undefined
    ? keyItems(m.row)
    : valueItems(m.row, m.locale)
})

const menuLabel = computed(() => {
  const m = menu.value
  if (!m)
    return ''
  return m.locale === undefined
    ? t('menu.keyLabel', { key: m.row.key })
    : t('menu.valueLabel', { key: m.row.key, locale: m.locale })
})

async function startRename(row: KeyRow): Promise<void> {
  if (!canWrite.value)
    return
  renaming.value = { key: row.key, draft: row.key }
  await nextTick()
  renameInput.value?.[0]?.select()
}

async function commitRename(): Promise<void> {
  const edit = renaming.value
  if (!edit)
    return
  renaming.value = undefined
  const to = edit.draft.trim()
  containerProps.ref.value?.focus()
  if (!to || to === edit.key)
    return
  follow = to
  await run([
    {
      type: 'rename',
      from: edit.key,
      to,
      usages: true,
    },
  ])
  if (failure.value)
    follow = undefined
}

function onRenameKey(event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    renaming.value = undefined
    containerProps.ref.value?.focus()
  }
  else if (event.key === 'Enter') {
    event.preventDefault()
    void commitRename()
  }
}

function openReview(row: KeyRow, locale: string, type: ReviewType): void {
  const at = menu.value?.at ?? { x: 0, y: 0 }
  reviewing.value = {
    // Room for the composer: it is 24rem wide and about 12rem tall.
    at: {
      x: Math.max(8, Math.min(at.x, innerWidth - 392)),
      y: Math.max(8, Math.min(at.y, innerHeight - 216)),
    },
    key: row.key,
    locale,
    current: row.values[locale],
    type,
  }
}

function closeReview(): void {
  if (!reviewing.value)
    return
  reviewing.value = undefined
  containerProps.ref.value?.focus()
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

    <div v-if="failure" class="shrink-0 flex items-center gap-2 border-b border-base px-4 py-1.5 color-error" role="alert">
      <span class="i-ph-x-circle-duotone" />
      <span class="flex-auto color-base">{{ failure }}</span>
      <button class="btn-ghost h-7" @click="failure = undefined">
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
      @contextmenu="onContextMenu"
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
          :data-row="index"
        >
          <div
            class="flex min-w-0 cursor-pointer items-center gap-1.5 px-4 font-mono text-xs"
            :class="index === active.row && active.col === 0 ? 'outline outline-1 outline-[var(--x-fg)] -outline-offset-1' : ''"
            role="gridcell"
            data-col="0"
            :title="row.label === undefined ? row.key : `${row.label}\n${row.key}`"
            @click="move(index, 0)"
            @dblclick="open(row)"
          >
            <input
              v-if="renaming && renaming.key === row.key"
              ref="renameInput"
              v-model="renaming.draft"
              class="w-full bg-transparent outline-none"
              :aria-label="t('menu.renameLabel', { key: row.key })"
              @keydown="onRenameKey"
              @blur="renaming = undefined"
              @dblclick.stop
            >
            <template v-else>
              <span class="truncate">{{ nameOf(row) }}</span>
              <span v-if="row.unused" class="i-ph-ghost-duotone shrink-0 color-faint" :title="t('keys.unusedHint')" />
              <span v-if="row.diagnostics" class="badge shrink-0 border-current color-error" :title="t('keys.diagnosticsHint')">{{ row.diagnostics }}</span>
            </template>
          </div>
          <div
            v-for="(locale, col) in locales"
            :key="locale"
            class="flex min-w-0 items-center border-l border-base px-3"
            :class="index === active.row && active.col === col + 1 ? 'outline outline-1 outline-[var(--x-fg)] -outline-offset-1' : ''"
            role="gridcell"
            :data-locale="locale"
            :data-col="col + 1"
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
      <span>{{ t('keys.helpMenu') }}</span>
    </div>

    <ContextMenu v-if="menu" :items="menuItems" :at="menu.at" :label="menuLabel" @close="closeMenu" />

    <Teleport v-if="reviewing" to="body">
      <div ref="reviewPanel" class="fixed z-50 w-96 shadow-lg" :style="{ left: `${reviewing.at.x}px`, top: `${reviewing.at.y}px` }">
        <ReviewComposer :review-key="reviewing.key" :locale="reviewing.locale" :current="reviewing.current" :initial-type="reviewing.type" @close="closeReview" />
      </div>
    </Teleport>
  </div>
</template>
