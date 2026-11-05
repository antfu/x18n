<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

// The current page in each locale of `utils/locales.ts`.
const active = useDocsLocale()

const items = computed<DropdownMenuItem[]>(() => active.value.alternates.map(({ locale, to }) => ({
  label: locale.name,
  // A checkbox item shows the check mark on the current locale; it navigates on select.
  type: 'checkbox' as const,
  checked: locale.code === active.value.locale.code,
  onSelect: () => navigateTo(to),
})))
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'end' }"
  >
    <UButton
      icon="i-ph-translate"
      color="neutral"
      variant="ghost"
      :aria-label="`Language: ${active.locale.name}`"
    />
  </UDropdownMenu>
</template>
