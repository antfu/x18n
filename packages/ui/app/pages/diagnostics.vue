<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NuxtLink } from '#components'
import { useRoute, useRouter } from '#imports'
import CopyPrompt from '../components/CopyPrompt.vue'
import FilePath from '../components/FilePath.vue'
import LocaleFlag from '../components/LocaleFlag.vue'
import UiPage from '../components/ui/UiPage.vue'
import { t } from '../i18n'
import { fixPrompt } from '../prompt'
import { useLive } from '../state'

const route = useRoute()
const router = useRouter()
const analysis = useLive((b, project) => b.analysis(project))

const code = computed(() => typeof route.query.code === 'string'
  ? route.query.code
  : undefined)
const all = computed(() => analysis.value?.diagnostics ?? [])

const codes = computed(() => {
  const groups = new Map<string, { code: string, severity: string, count: number }>()
  for (const d of all.value) {
    const group = groups.get(d.code) ?? { code: d.code, severity: d.severity, count: 0 }
    group.count++
    groups.set(d.code, group)
  }
  return [
    ...groups.values(),
  ].sort((a, b) => b.count - a.count)
})

const rows = computed(() => all.value
  .filter(d => !code.value || d.code === code.value)
  .toSorted((a, b) => (a.severity === b.severity
    ? 0
    : a.severity === 'error'
      ? -1
      : 1)))

// Rows are mounted a page at a time: tens of thousands of variable-height rows block the tab.
const PAGE = 200
const limit = ref(PAGE)
watch(code, () => {
  limit.value = PAGE
})
const shown = computed(() => rows.value.slice(0, limit.value))

function select(next: string | undefined): void {
  void router.replace({
    query: next
      ? { code: next }
      : {},
  })
}
</script>

<template>
  <UiPage v-if="analysis">
    <div class="flex flex-wrap items-center gap-2 border-b border-base px-4 py-3">
      <button type="button" class="btn h-7" :class="code ? 'btn-ghost' : 'border-strong'" @click="select(undefined)">
        {{ t('diagnostics.all', { count: all.length }) }}
      </button>
      <button
        v-for="c in codes"
        :key="c.code"
        type="button"
        class="btn h-7 font-mono text-xs"
        :class="code === c.code ? 'border-strong' : 'btn-ghost'"
        @click="select(c.code)"
      >
        <span :class="c.severity === 'error' ? 'i-ph-x-circle-duotone color-error' : 'i-ph-warning-duotone color-warn'" />
        {{ c.code }} <span class="tabular-nums color-muted">{{ c.count }}</span>
      </button>
      <span class="flex-auto" />
      <CopyPrompt v-if="rows.length" :text="fixPrompt(code)" :label="t('diagnostics.copyFix')" :hint="code ? t('diagnostics.fixCodeHint', { code }) : t('diagnostics.fixHint')" />
    </div>

    <p v-if="!rows.length" class="border-b border-base px-4 py-3 color-muted">
      {{ t('overview.clean') }}
    </p>
    <div v-for="(d, i) in shown" :key="i" class="grid gap-1 border-b border-base px-4 py-3">
      <div class="flex items-center gap-2">
        <span :class="d.severity === 'error' ? 'i-ph-x-circle-duotone color-error' : 'i-ph-warning-duotone color-warn'" />
        <span class="font-mono text-xs color-muted">{{ d.code }}</span>
        <span class="flex-auto" />
        <span v-if="d.locale" class="inline-flex items-center gap-1.5 font-mono text-xs"><LocaleFlag :code="d.locale" />{{ d.locale }}</span>
      </div>
      <p>{{ d.message }}</p>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <NuxtLink v-if="d.key" :to="`/keys/${encodeURIComponent(d.key)}`" class="focus-ring font-mono text-xs hover:underline">
          {{ d.key }}
        </NuxtLink>
        <FilePath v-if="d.file" :path="d.file" :line="d.range?.line" :column="d.range?.column" />
      </div>
    </div>
    <div v-if="shown.length < rows.length" class="flex items-center gap-3 px-4 py-3">
      <button type="button" class="btn-outline h-7" @click="limit += PAGE">
        {{ t('diagnostics.showMore', { count: Math.min(PAGE, rows.length - shown.length) }) }}
      </button>
      <span class="font-mono text-xs color-muted tabular-nums">{{ t('diagnostics.shown', { shown: shown.length, total: rows.length }) }}</span>
    </div>
  </UiPage>
</template>
