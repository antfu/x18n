<!-- The top nav. When its tabs do not fit (long labels, a narrow panel) the row scrolls on its own: a fade and an arrow
show the side with more tabs, the mouse wheel scrolls it, and the open page's tab is kept in view. -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NuxtLink } from '#components'
import { useRoute, useRouter } from '#imports'
import { t } from '../i18n'

const props = defineProps<{
  items: readonly { to: string, label: string, count?: number }[]
}>()

/** Width of the fade on a side that has more tabs. */
const fadePx = 24
const fade = `${fadePx}px`

const row = ref<HTMLElement>()
const canLeft = ref(false)
const canRight = ref(false)
const route = useRoute()
const router = useRouter()

function update(): void {
  const el = row.value
  if (!el)
    return
  canLeft.value = el.scrollLeft > 1
  canRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function step(direction: -1 | 1): void {
  row.value?.scrollBy({ left: direction * row.value.clientWidth * 0.7, behavior: 'smooth' })
}

/** A vertical wheel scrolls the row sideways, since it has no scrollbar. */
function wheel(event: WheelEvent): void {
  const el = row.value
  if (!el || el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY))
    return
  const before = el.scrollLeft
  el.scrollLeft += event.deltaY
  // At an end the wheel goes on to the page as usual.
  if (el.scrollLeft !== before)
    event.preventDefault()
}

/** Scrolls the open page's tab into the row's view, without moving anything else on the page. */
function revealActive(): void {
  const el = row.value
  // The tab of the longest `to` the path starts with; `/` only on the overview itself.
  const index = props.items.reduce((best, item, i) => (item.to === '/'
    ? route.path === '/'
    : route.path === item.to || route.path.startsWith(`${item.to}/`)) && (best === -1 || item.to.length > props.items[best]!.to.length)
    ? i
    : best, -1)
  const active = index === -1
    ? undefined
    : el?.children[index] as HTMLElement | undefined
  if (!el || !active)
    return
  // Clear of the fade on a side that has more tabs beyond the active one.
  const left = active.offsetLeft - el.offsetLeft
  const right = left + active.offsetWidth
  const before = left > 0
    ? fadePx
    : 0
  const after = right < el.scrollWidth
    ? fadePx
    : 0
  if (left - before < el.scrollLeft)
    el.scrollLeft = left - before
  else if (right + after > el.scrollLeft + el.clientWidth)
    el.scrollLeft = right + after - el.clientWidth
}

let observer: ResizeObserver | undefined
/** Watches the row and each tab: a tab that widens (a count badge, a font) can make the row overflow without resizing it. */
function observe(): void {
  observer?.disconnect()
  if (!row.value)
    return
  observer ??= new ResizeObserver(update)
  observer.observe(row.value)
  for (const tab of row.value.children)
    observer.observe(tab)
}
onMounted(() => {
  observe()
  update()
  // On a direct load the tab of the page is active only once the router has resolved it.
  void router.isReady().then(() => nextTick(() => {
    revealActive()
    update()
  }))
})
onBeforeUnmount(() => observer?.disconnect())
// Also when the tabs change (the messages load after the first render, a language switch, a count), which widens the row.
watch([
  () => route.path,
  () => props.items.map(item => `${item.to} ${item.label} ${item.count ?? ''}`).join(),
], () => nextTick(() => {
  observe()
  revealActive()
  update()
}))
</script>

<template>
  <div class="relative flex min-w-0 items-center">
    <!-- The arrows sit beside the row, never over a tab. Both stay while the row overflows (dimmed at an end), so the tabs
    do not shift and a focused arrow keeps the focus. -->
    <button v-if="canLeft || canRight" type="button" class="btn-icon h-7 w-6 shrink-0" :class="!canLeft && 'opacity-30'" :aria-disabled="!canLeft" :aria-label="t('nav.scrollLeft')" :title="t('nav.scrollLeft')" @click="canLeft && step(-1)">
      <span class="i-ph-caret-left" />
    </button>
    <nav
      ref="row"
      class="flex min-w-0 items-center gap-1 of-x-auto [scrollbar-width:none]"
      :style="{
        maskImage: canLeft || canRight
          ? `linear-gradient(to right, ${canLeft ? `transparent, black ${fade}` : 'black'}, ${canRight ? `black calc(100% - ${fade}), transparent` : 'black'})`
          : undefined,
      }"
      @scroll.passive="update"
      @wheel="wheel"
    >
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="focus-ring whitespace-nowrap px-2 py-1 font-mono text-xs uppercase tracking-[0.12em] color-muted transition-colors hover:color-base"
        :active-class="item.to === '/' ? '' : '!color-base'"
        exact-active-class="!color-base"
      >
        {{ item.label }}
        <span v-if="item.count" class="ml-1 tabular-nums color-warn">{{ item.count }}</span>
      </NuxtLink>
    </nav>
    <button v-if="canLeft || canRight" type="button" class="btn-icon h-7 w-6 shrink-0" :class="!canRight && 'opacity-30'" :aria-disabled="!canRight" :aria-label="t('nav.scrollRight')" :title="t('nav.scrollRight')" @click="canRight && step(1)">
      <span class="i-ph-caret-right" />
    </button>
  </div>
</template>
