<!-- The sidebar navigation, for the desktop aside and the mobile drawer. A tab with page groups (Presets) gets an accordion with the current page's group open; other tabs keep the layer's always-open groups. -->
<script setup lang="ts">
const sidebar = useFilteredNavigation()
// Grouped sidebars mark each group with `current`.
const accordion = computed(() => sidebar.value.some(item => 'current' in item))

// Re-mounting when the current page's group changes opens that group, also after a link from another group.
// It closes the groups the reader opened by hand, which only happens on a move to another group.
const currentGroup = computed(() => sidebar.value.find(item => item.current)?.path)
</script>

<template>
  <UContentNavigation
    :key="currentGroup"
    variant="link"
    :collapsible="accordion"
    :navigation="sidebar"
  />
</template>
