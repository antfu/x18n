<script setup lang="ts">
import { computed } from 'vue'
import { NuxtLink } from '#components'
import { useRoute, useRouter } from '#imports'
import CopyPrompt from '../components/CopyPrompt.vue'
import FilePath from '../components/FilePath.vue'
import LocaleFlag from '../components/LocaleFlag.vue'
import ShowMore from '../components/ShowMore.vue'
import UiPage from '../components/ui/UiPage.vue'
import { useDiagnostics } from '../diagnostics'
import { t } from '../i18n'
import { fixPrompt } from '../prompt'

const route = useRoute()
const router = useRouter()

const code = computed(() => typeof route.query.code === 'string'
  ? route.query.code
  : undefined)
// The server sends the diagnostics a page at a time, errors first: a large project has tens of thousands.
const { data, more } = useDiagnostics(() => code.value === undefined
  ? {}
  : {
      codes: [code.value],
    })
const codes = computed(() => data.value?.byCode ?? [])
const all = computed(() => codes.value.reduce((sum, c) => sum + c.count, 0))
const rows = computed(() => data.value?.items ?? [])

function select(next: string | undefined): void {
  void router.replace({
    query: next
      ? { code: next }
      : {},
  })
}
</script>

<template>
  <UiPage v-if="data">
    <div class="flex flex-wrap items-center gap-2 border-b border-base px-4 py-3">
      <button type="button" class="btn h-7" :class="code ? 'btn-ghost' : 'border-strong'" @click="select(undefined)">
        {{ t('diagnostics.all', { count: all }) }}
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
    <div v-for="(d, i) in rows" :key="i" class="grid gap-1 border-b border-base px-4 py-3">
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
    <ShowMore v-if="data" :shown="rows.length" :total="data.total" :step="data.pageSize" @more="more" />
  </UiPage>
</template>
