<!-- An icon inline in Markdown, such as a logo before a heading: `### :x18n-icon{name="i-logos-vue"} Vue`. -->
<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template>
  <UIcon :name="name" mode="svg" class="me-2 inline-block size-[0.9em] align-[-0.1em]" aria-hidden="true" />
</template>
