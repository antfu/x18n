<!-- A new review on one message, styled like the message editor. -->
<script setup lang="ts">
import type { MessageLeaf, ReviewType } from '@x18n/core'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { applyEdit } from '../edit'
import { t } from '../i18n'
import { reviewTypeOrder, reviewTypes } from '../review'

const { reviewKey, locale, current, initialType = 'comment' } = defineProps<{
  reviewKey: string
  locale: string
  /** The review type selected when it opens. */
  initialType?: ReviewType
  /** Starts the suggested value, so a suggestion edits the current one. */
  current?: MessageLeaf | undefined
}>()
const emit = defineEmits<{ close: [] }>()

const type = ref<ReviewType>(initialType)
const text = ref('')
const suggestion = ref(current === undefined || current === null
  ? ''
  : String(current))
const sending = ref(false)
const textField = useTemplateRef<HTMLTextAreaElement>('textField')
const valueField = useTemplateRef<HTMLInputElement>('valueField')

const canSend = computed(() => !sending.value && (type.value === 'suggestion'
  ? suggestion.value !== '' && suggestion.value !== String(current ?? '')
  : type.value === 'approve' || text.value.trim() !== ''))

onMounted(() => type.value === 'suggestion'
  ? valueField.value?.select()
  : textField.value?.focus())
watch(type, async (next) => {
  await nextTick()
  if (next === 'suggestion')
    valueField.value?.select()
  else
    textField.value?.focus()
})

async function send(): Promise<void> {
  if (!canSend.value)
    return
  sending.value = true
  try {
    await applyEdit([
      {
        type: 'review',
        key: reviewKey,
        locale,
        review: type.value,
        ...text.value.trim() && {
          text: text.value.trim(),
        },
        ...type.value === 'suggestion' && { suggestion: suggestion.value },
      },
    ])
    emit('close')
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <form class="border border-inverse bg-base" :aria-label="t('review.add')" @submit.prevent="send" @keydown.escape.prevent="emit('close')">
    <div class="flex flex-wrap gap-1 border-b border-base p-1" role="tablist" :aria-label="t('review.type')">
      <button
        v-for="value in reviewTypeOrder"
        :key="value"
        type="button"
        role="tab"
        :aria-selected="type === value"
        class="btn h-7 px-2"
        :class="type === value ? 'border-strong bg-hover color-base' : 'border-transparent color-muted hover:color-base hover:bg-hover'"
        @click="type = value"
      >
        <span :class="[reviewTypes[value].icon, type === value && reviewTypes[value].color]" />
        {{ t(reviewTypes[value].label) }}
      </button>
    </div>
    <input
      v-if="type === 'suggestion'"
      ref="valueField"
      v-model="suggestion"
      class="block w-full border-b border-base bg-transparent px-3 py-2 font-mono text-sm outline-none placeholder:color-faint"
      :placeholder="t('review.suggestionPlaceholder')"
      :aria-label="t('review.suggestionPlaceholder')"
      @keydown.enter.prevent="send"
    >
    <textarea
      ref="textField"
      v-model="text"
      class="block min-h-14 w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:color-faint [field-sizing:content]"
      rows="2"
      :placeholder="t('review.textPlaceholder')"
      :aria-label="t('review.textPlaceholder')"
      @keydown.enter.exact.prevent="send"
    />
    <div class="flex items-center gap-2 border-t border-base py-1 pl-3 pr-1">
      <span class="flex-auto font-mono text-[11px] color-faint">{{ t('review.hint') }}</span>
      <button type="button" class="btn-ghost h-7" @click="emit('close')">
        <span class="i-ph-x" /> {{ t('edit.cancel') }}
      </button>
      <button type="submit" class="btn-solid h-7" :disabled="!canSend">
        <span class="i-ph-paper-plane-tilt" /> {{ t('review.send') }}
      </button>
    </div>
  </form>
</template>
