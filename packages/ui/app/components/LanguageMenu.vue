<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { ref, useTemplateRef } from 'vue'
import { endonym, pickUiLocale, t, uiLocale, uiLocales } from '../i18n'

const root = useTemplateRef<HTMLElement>('root')
const open = ref(false)

onClickOutside(root, () => open.value = false)

function pick(locale: typeof uiLocales[number]): void {
  pickUiLocale(locale)
  open.value = false
}
</script>

<template>
  <div ref="root" class="relative" @keydown.escape="open = false">
    <button type="button" class="btn-icon" :class="open && 'bg-hover color-base'" :aria-label="t('app.language')" aria-haspopup="menu" :aria-expanded="open" @click="open = !open">
      <span class="i-ph-translate-duotone text-base" />
    </button>
    <div v-if="open" class="absolute right-0 top-full z-30 mt-1 min-w-36 border border-strong bg-base py-1 shadow-lg" role="menu">
      <button
        v-for="option in uiLocales"
        :key="option"
        type="button"
        role="menuitemradio"
        :aria-checked="option === uiLocale"
        :lang="option"
        class="focus-ring flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-hover"
        :class="option === uiLocale ? 'color-base' : 'color-muted'"
        @click="pick(option)"
      >
        <span class="i-ph-check-duotone shrink-0" :class="option !== uiLocale && 'op-0'" />
        {{ endonym(option) }}
      </button>
    </div>
  </div>
</template>
