<!-- Shadows the comark-docs layer's docs layout to use `DocsSidebarNavigation`; otherwise the same. -->
<template>
  <UContainer>
    <UPage>
      <template #left>
        <UPageAside>
          <DocsSidebarNavigation />
        </UPageAside>
      </template>

      <slot />
    </UPage>
  </UContainer>
</template>
