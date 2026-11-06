<!-- A page column between two guide lines; full width pages (the grid) skip it. It stays 6px clear of each side, where the
corner marks of its sections reach, so a narrow panel does not scroll sideways. -->
<template>
  <div class="mx-auto min-h-full w-[calc(100%-0.75rem)] max-w-6xl border-x border-base">
    <slot />
  </div>
</template>
