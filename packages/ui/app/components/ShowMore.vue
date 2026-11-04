<script setup lang="ts">
import { t } from '../i18n'

// The end of a list mounted a part at a time: a button for the next part and how much is shown.
const props = defineProps<{ shown: number, total: number, step: number }>()
const emit = defineEmits<{ more: [] }>()
</script>

<template>
  <div v-if="props.shown < props.total" class="flex items-center gap-3 px-4 py-3">
    <button type="button" class="btn-outline h-7" @click="emit('more')">
      {{ t('list.showMore', { count: Math.min(props.step, props.total - props.shown) }) }}
    </button>
    <span class="font-mono text-xs color-muted tabular-nums">{{ t('list.shown', { shown: props.shown, total: props.total }) }}</span>
  </div>
</template>
