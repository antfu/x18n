<script setup lang="ts" generic="T">
import type { ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useResizeObserver } from '@vueuse/core'
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'

// A long list in the page flow: only the rows near the viewport are mounted. Rows may differ in
// height; each is measured once mounted. The page scrolls in the app's `<main>`, so the list
// keeps its offset in it (`scrollMargin`) up to date as content above it changes.
const props = withDefaults(defineProps<{
  items: readonly T[]
  /** Height of a row before it is measured, in pixels. */
  estimate: number
  /** Stable key of a row; the index by default. */
  getKey?: ((item: T, index: number) => string | number) | undefined
  overscan?: number
}>(), {
  overscan: 8,
})

const emit = defineEmits<{
  /** The last rows are mounted: load more, when there is more. */
  end: []
}>()

defineSlots<{
  default: (props: { item: T, index: number }) => unknown
}>()

const root = useTemplateRef<HTMLElement>('root')
const scrollElement = shallowRef<HTMLElement | null>(null)
const scrollMargin = ref(0)

function measureMargin(): void {
  const main = scrollElement.value
  const el = root.value
  if (!main || !el)
    return
  scrollMargin.value = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
}

onMounted(() => {
  scrollElement.value = root.value?.closest('main') ?? document.scrollingElement as HTMLElement | null
  measureMargin()
})
// Content above the list (a header, a panel that opens) moves it; the page content resizes then.
useResizeObserver(() => scrollElement.value?.firstElementChild as HTMLElement | undefined, measureMargin)

const virtualizer = useVirtualizer(computed(() => ({
  count: props.items.length,
  getScrollElement: () => scrollElement.value,
  estimateSize: () => props.estimate,
  overscan: props.overscan,
  scrollMargin: scrollMargin.value,
  ...props.getKey && {
    getItemKey: (index: number) => props.getKey!(props.items[index]!, index),
  },
})))

const rows = computed(() => virtualizer.value.getVirtualItems())

function measure(el: Element | ComponentPublicInstance | null): void {
  if (el instanceof Element)
    virtualizer.value.measureElement(el)
}

// Once per length: the last row mounted asks for more, and asks again only after more arrived.
let askedAt = -1
watch(() => rows.value.at(-1)?.index, (last) => {
  const count = props.items.length
  if (last !== undefined && last >= count - 1 && askedAt !== count) {
    askedAt = count
    emit('end')
  }
})
</script>

<template>
  <div ref="root" class="relative w-full" :style="{ height: `${virtualizer.getTotalSize()}px` }">
    <div
      v-for="row in rows"
      :key="String(row.key)"
      :ref="measure"
      :data-index="row.index"
      class="absolute left-0 top-0 w-full"
      :style="{ transform: `translateY(${row.start - scrollMargin}px)` }"
    >
      <slot :item="items[row.index]!" :index="row.index" />
    </div>
  </div>
</template>
