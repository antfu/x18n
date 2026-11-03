<script setup lang="ts">
// A static pane: it never starts an animation, so the demo stops cycling here.
const prompt = `Set up https://x18n.dev/ in this project. Run \`pnpx @x18n/cli prompt setup\` and follow the instructions it prints.`

const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(prompt)
    copied.value = true
    setTimeout(() => copied.value = false, 2000)
  }
  catch {}
}
</script>

<template>
  <div class="flex h-full flex-col justify-center gap-5 p-6 sm:p-8">
    <div>
      <div class="mb-2 flex items-center justify-between">
        <span class="text-sm text-muted">Copy to your agent to install for you</span>
        <UButton
          :icon="copied ? 'i-ph-check' : 'i-ph-copy'"
          :label="copied ? 'Copied' : 'Copy'"
          color="neutral"
          variant="subtle"
          size="xs"
          @click="copy"
        />
      </div>
      <pre class="overflow-x-auto whitespace-pre-wrap rounded-md border border-muted bg-elevated p-4 font-mono text-sm leading-relaxed text-highlighted">{{ prompt }}</pre>
      <NuxtLink to="/guide/getting-started" class="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline">
        Read the full installation guide
        <UIcon name="i-ph-arrow-right" class="size-3.5" />
      </NuxtLink>
    </div>
    <div class="flex flex-wrap gap-3">
      <UButton
        to="vscode:extension/antfu.x18n"
        external
        icon="i-bxl-visual-studio"
        label="Install VS Code extension"
        size="lg"
      />
      <UButton
        to="/references/lsp-protocol#editor-setup"
        icon="i-ph-plugs-connected-duotone"
        label="Setup for other IDEs"
        color="neutral"
        variant="subtle"
        size="lg"
      />
    </div>
  </div>
</template>
