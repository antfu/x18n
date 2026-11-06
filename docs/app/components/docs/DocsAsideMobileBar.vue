<!-- Shadows the comark-docs layer's mobile bar to use `DocsSidebarNavigation` in the menu drawer; otherwise the same. -->
<script setup lang="ts">
import type { ContentTocLink } from '@nuxt/ui'

defineProps<{
  tocLinks?: ContentTocLink[]
}>()

const appConfig = useAppConfig()
const mainNavigation = useMainNavigation()
const title = computed(() => mainNavigation.value.find(item => item.active)?.label)

const menuDrawerOpen = ref(false)
const tocDrawerOpen = ref(false)
const layout = inject('layout')
</script>

<template>
  <div
    class="lg:hidden sticky top-(--ui-header-height) z-10 bg-default -mx-6 p-2 px-6 border-b border-muted flex h-13"
    :class="layout === 'page' ? 'justify-end' : 'justify-between'"
  >
    <UDrawer
      v-if="layout === 'docs'"
      v-model:open="menuDrawerOpen"
      direction="left"
      :title="title"
      :handle="false"
      inset
      side="left"
      :ui="{ content: 'w-full max-w-2/3' }"
    >
      <UButton
        label="Menu"
        icon="i-lucide-menu"
        color="neutral"
        variant="link"
        size="md"
        aria-label="Open menu"
        class="text-highlighted font-normal text-md gap-2 -ms-2.5"
        :ui="{ leadingIcon: 'size-4.5' }"
      />

      <template #body>
        <DocsSidebarNavigation />
      </template>
    </UDrawer>

    <UDrawer
      v-if="tocLinks?.length"
      v-model:open="tocDrawerOpen"
      direction="right"
      :handle="false"
      inset
      side="right"
      no-body-styles
      :ui="{ content: 'w-full max-w-2/3' }"
    >
      <UButton
        icon="i-lucide-file-text"
        color="neutral"
        variant="outline"
        square
        :aria-label="appConfig.toc.title"
        class="p-1 px-2 -me-1.5"
        :ui="{ leadingIcon: 'size-[17px]' }"
      />

      <template #body>
        <UContentToc
          v-if="tocLinks?.length"
          :title="appConfig.toc?.title"
          :links="tocLinks"
          :open="true"
          default-open
          :ui="{
            root: '!mx-0 !px-1 top-0 overflow-visible bg-default',
            container: '!pt-0 border-b-0',
            trailingIcon: 'hidden',
            bottom: 'flex flex-col',
            title: 'text-highlighted font-medium',
            item: 'py-1',
          }"
        >
          <template #bottom>
            <slot name="bottom" />
          </template>
        </UContentToc>
      </template>
    </UDrawer>
  </div>
</template>
