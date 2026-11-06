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
  el.scrollLeft += event.deltaY
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
  const left = active.offsetLeft - el.offsetLeft
  if (left < el.scrollLeft)
    el.scrollLeft = left
  else if (left + active.offsetWidth > el.scrollLeft + el.clientWidth)
    el.scrollLeft = left + active.offsetWidth - el.clientWidth
}

let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(update)
  observer.observe(row.value!)
  update()
  // On a direct load the tab of the page is active only once the router has resolved it.
  void router.isReady().then(() => nextTick(() => {
    revealActive()
    update()
  }))
})
onBeforeUnmount(() => observer?.disconnect())
// Also when the labels change (the messages load after the first render, a language switch), which widens the row.
watch([
  () => route.path,
  () => props.items.map(item => item.label).join(),
], () => nextTick(() => {
  revealActive()
  update()
}))

const fade = '1.5rem'
</script>

<template>
  <div class="relative flex min-w-0 items-center">
    <!-- The arrows sit beside the row, never over a tab. -->
    <button v-if="canLeft" type="button" class="btn-icon h-7 w-6 shrink-0" :aria-label="t('nav.scrollLeft')" :title="t('nav.scrollLeft')" @click="step(-1)">
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
    <button v-if="canRight" type="button" class="btn-icon h-7 w-6 shrink-0" :aria-label="t('nav.scrollRight')" :title="t('nav.scrollRight')" @click="step(1)">
      <span class="i-ph-caret-right" />
    </button>
  </div>
</template>
