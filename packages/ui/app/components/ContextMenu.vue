<!-- A menu at a point, for right click and the context menu key. The parent decides what it lists and when it shows. -->
<script setup lang="ts">
import type { MenuItem, MenuPosition } from '../menu'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'

const { items, at, label } = defineProps<{
  items: readonly MenuItem[]
  at: MenuPosition
  label: string
}>()
const emit = defineEmits<{ close: [] }>()

type Action = Extract<MenuItem, { action: unknown }>

const root = useTemplateRef<HTMLElement>('root')
const active = ref(-1)
const armed = ref<number>()
const position = ref({ left: at.x, top: at.y })

const isAction = (item: MenuItem): item is Action => 'action' in item
const enabled = computed(() => items.flatMap((item, i) => isAction(item) && !item.disabled
  ? [i]
  : []))

// Kept inside the viewport: opens up or left of the point when there is no room below or right.
async function place(): Promise<void> {
  await nextTick()
  const el = root.value
  if (!el)
    return
  const { width, height } = el.getBoundingClientRect()
  const margin = 4
  position.value = {
    left: Math.max(margin, at.x + width > innerWidth - margin
      ? at.x - width
      : at.x),
    top: Math.max(margin, at.y + height > innerHeight - margin
      ? at.y - height
      : at.y),
  }
}

onMounted(() => {
  void place()
  root.value?.focus()
})
watch(() => [items.length, at], () => void place())

onClickOutside(root, () => emit('close'))
useEventListener(window, 'blur', () => emit('close'))
useEventListener(window, 'resize', () => emit('close'))
useEventListener(window, 'scroll', () => emit('close'), { capture: true, passive: true })

function step(by: number): void {
  const list = enabled.value
  if (!list.length)
    return
  const at = list.indexOf(active.value)
  active.value = at < 0
    ? list[by > 0
      ? 0
      : list.length - 1]!
    : list[(at + by + list.length) % list.length]!
}

function run(index: number): void {
  const item = items[index]
  if (!item || !isAction(item) || item.disabled)
    return
  if (item.confirm && armed.value !== index) {
    armed.value = index
    return
  }
  emit('close')
  void item.action()
}

function onKey(event: KeyboardEvent): void {
  const keys: Record<string, () => void> = {
    'ArrowDown': () => step(1),
    'ArrowUp': () => step(-1),
    'Home': () => active.value = enabled.value[0] ?? -1,
    'End': () => active.value = enabled.value.at(-1) ?? -1,
    'Enter': () => run(active.value),
    ' ': () => run(active.value),
    'Escape': () => emit('close'),
    'Tab': () => emit('close'),
  }
  const action = keys[event.key]
  if (action) {
    event.preventDefault()
    event.stopPropagation()
    action()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="fixed z-50 min-w-56 max-w-96 border border-strong bg-base py-1 text-sm shadow-lg outline-none"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      role="menu"
      tabindex="-1"
      :aria-label="label"
      :aria-activedescendant="active >= 0 ? `x-menu-item-${active}` : undefined"
      @keydown="onKey"
      @contextmenu.prevent
    >
      <template v-for="(item, i) in items" :key="i">
        <div v-if="'separator' in item" class="my-1 border-t border-base" role="separator" />
        <div v-else-if="'heading' in item" class="label truncate px-3 pb-0.5 pt-1.5" role="presentation">
          {{ item.heading }}
        </div>
        <div
          v-else
          :id="`x-menu-item-${i}`"
          class="flex h-8 cursor-pointer select-none items-center gap-2 px-3"
          :class="[
            item.disabled ? 'cursor-default color-faint' : item.danger ? 'color-error' : 'color-base',
            active === i && !item.disabled && 'bg-hover',
          ]"
          role="menuitem"
          :aria-disabled="item.disabled || undefined"
          @pointerenter="active = item.disabled ? -1 : i"
          @pointerleave="active = -1"
          @click="run(i)"
        >
          <span class="shrink-0" :class="item.icon ?? 'w-1em'" />
          <span class="flex-auto truncate">{{ armed === i && item.confirm ? item.confirm : item.label }}</span>
          <kbd v-if="item.hint" class="badge shrink-0">{{ item.hint }}</kbd>
        </div>
      </template>
    </div>
  </Teleport>
</template>
