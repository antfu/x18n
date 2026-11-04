<script setup lang="ts">
import type { UnusedDeletionView, UsageView } from '../../src/node/types'
import { computed, ref } from 'vue'
import { NuxtLink } from '#components'
import CodeSnippet from '../components/CodeSnippet.vue'
import FilePath from '../components/FilePath.vue'
import ShowMore from '../components/ShowMore.vue'
import UiPage from '../components/ui/UiPage.vue'
import UiSegmented from '../components/ui/UiSegmented.vue'
import { t } from '../i18n'
import { listStep, useShowMore } from '../show-more'
import { backend, projectName, useLive } from '../state'

const analysis = useLive((b, project) => b.analysis(project))
const usages = useLive((b, project) => b.usages(project))

const tab = ref<'missing' | 'unused' | 'dynamic' | 'all'>('missing')
const filter = ref('')

const undefinedByKey = computed(() => {
  const groups = new Map<string, UsageView[]>()
  for (const usage of analysis.value?.undefinedUsages ?? []) {
    const list = groups.get(usage.key ?? usage.raw) ?? []
    groups.set(usage.key ?? usage.raw, list)
    list.push(usage)
  }
  return [...groups]
})
const dynamic = computed(() => (usages.value ?? []).filter(u => u.dynamic !== false))
const all = computed(() => (usages.value ?? []).filter(u => !filter.value || u.path.includes(filter.value) || (u.key ?? u.raw).includes(filter.value)))
const unused = computed(() => analysis.value?.unused ?? [])

// Each tab mounts its list a part at a time, from the start again when the tab or the filter changes.
const { shown: shownUndefined, more: moreUndefined } = useShowMore(undefinedByKey, () => tab.value)
const { shown: shownUnused, more: moreUnused } = useShowMore(unused, () => tab.value)
const { shown: shownDynamic, more: moreDynamic } = useShowMore(dynamic, () => tab.value)
const { shown: shownAll, more: moreAll } = useShowMore(all, () => [tab.value, filter.value])

// The bulk delete: a dry run first, then the write after the user confirms.
const deletion = ref<UnusedDeletionView>()
const deleted = ref<{ count: number, files: number }>()
const busy = ref(false)
const deletionFiles = computed(() => new Set(deletion.value?.deleted.flatMap(k => k.messages.map(m => m.path))).size)

async function planDeletion(): Promise<void> {
  busy.value = true
  deleted.value = undefined
  try {
    deletion.value = await backend.value!.deleteUnused({ project: projectName.value })
  }
  finally {
    busy.value = false
  }
}

async function confirmDeletion(): Promise<void> {
  busy.value = true
  try {
    const result = await backend.value!.deleteUnused({ project: projectName.value, confirm: true })
    deleted.value = { count: result.deleted.length, files: result.changes.length }
    deletion.value = undefined
  }
  finally {
    busy.value = false
  }
}

const tabs = computed(() => [
  {
    value: 'missing' as const,
    label: t('usages.missing', { count: undefinedByKey.value.length }),
  },
  {
    value: 'unused' as const,
    label: t('usages.unused', { count: analysis.value?.unused.length ?? 0 }),
  },
  {
    value: 'dynamic' as const,
    label: t('usages.dynamic', { count: dynamic.value.length }),
  },
  {
    value: 'all' as const,
    label: t('usages.all', { count: usages.value?.length ?? 0 }),
  },
])
</script>

<template>
  <UiPage>
    <div class="flex flex-wrap items-center gap-3 border-b border-base px-4 py-3">
      <UiSegmented v-model="tab" :options="tabs" :label="t('nav.usages')" />
      <input v-if="tab === 'all'" v-model="filter" class="input w-72" :placeholder="t('usages.filter')" :aria-label="t('usages.filter')">
    </div>

    <template v-if="tab === 'missing'">
      <p class="border-b border-base px-4 py-2 text-xs color-muted">
        {{ t('usages.missingHint') }}
      </p>
      <div v-for="[key, list] in shownUndefined" :key="key" class="grid gap-2 border-b border-base px-4 py-3">
        <span class="font-mono font-medium color-error">{{ key }}</span>
        <div v-for="(usage, i) in list" :key="i" class="grid gap-1">
          <FilePath :path="usage.path" :line="usage.line" :column="usage.column" />
          <CodeSnippet :usage="usage" />
        </div>
      </div>
      <ShowMore :shown="shownUndefined.length" :total="undefinedByKey.length" :step="listStep" @more="moreUndefined" />
    </template>

    <template v-else-if="tab === 'unused'">
      <div class="flex flex-wrap items-center gap-3 border-b border-base px-4 py-2">
        <p class="flex-auto text-xs color-muted">
          {{ t('usages.unusedHint') }}
        </p>
        <button v-if="backend?.capabilities.write && analysis?.unused.length && !deletion" class="btn-outline" :disabled="busy" @click="planDeletion">
          {{ t('usages.deleteUnused') }}
        </button>
      </div>
      <p v-if="deleted" class="border-b border-base px-4 py-2 text-xs" role="status">
        {{ t('usages.deleteDone', deleted) }}
      </p>
      <div v-if="deletion" class="grid gap-2 border-b border-base px-4 py-3 text-xs">
        <p v-if="deletion.deleted.length">
          {{ t('usages.deletePlan', { count: deletion.deleted.length, files: deletionFiles }) }}
        </p>
        <p v-else>
          {{ t('usages.deleteNone') }}
        </p>
        <template v-if="deletion.kept.length">
          <p class="color-muted">
            {{ t('usages.deleteKept', { count: deletion.kept.length }) }}
          </p>
          <div v-for="k in deletion.kept" :key="k.key" class="flex flex-wrap items-center gap-2 font-mono">
            <span>{{ k.key }}</span>
            <FilePath v-for="(usage, i) in k.usages" :key="i" :path="usage.path" :line="usage.line" :column="usage.column" />
          </div>
        </template>
        <p v-for="warning in deletion.warnings" :key="warning" class="color-warn">
          {{ warning }}
        </p>
        <div class="flex gap-2">
          <button v-if="deletion.deleted.length" class="btn-solid" :disabled="busy" @click="confirmDeletion">
            {{ t('usages.deleteConfirm', { count: deletion.deleted.length }) }}
          </button>
          <button class="btn-outline" :disabled="busy" @click="deletion = undefined">
            {{ t('usages.deleteCancel') }}
          </button>
        </div>
      </div>
      <NuxtLink v-for="key in shownUnused" :key="key" :to="`/keys/${encodeURIComponent(key)}`" class="focus-ring flex items-center gap-2 border-b border-base px-4 py-1.5 font-mono text-xs transition-colors hover:bg-hover">
        <span class="i-ph-ghost-duotone color-faint" />
        {{ key }}
      </NuxtLink>
      <ShowMore :shown="shownUnused.length" :total="unused.length" :step="listStep" @more="moreUnused" />
    </template>

    <template v-else-if="tab === 'dynamic'">
      <p class="border-b border-base px-4 py-2 text-xs color-muted">
        {{ t('usages.dynamicHint') }}
      </p>
      <div v-for="(usage, i) in shownDynamic" :key="i" class="grid gap-1 border-b border-base px-4 py-3">
        <div class="flex items-center gap-2">
          <FilePath :path="usage.path" :line="usage.line" />
          <code class="font-mono text-xs color-info">{{ usage.raw }}</code>
        </div>
        <CodeSnippet :usage="usage" />
      </div>
      <ShowMore :shown="shownDynamic.length" :total="dynamic.length" :step="listStep" @more="moreDynamic" />
    </template>

    <template v-else>
      <div v-for="(usage, i) in shownAll" :key="i" class="grid grid-cols-[minmax(0,22rem)_1fr] items-center gap-4 border-b border-base px-4 py-1 transition-colors hover:bg-hover">
        <FilePath :path="usage.path" :line="usage.line" />
        <NuxtLink v-if="usage.key" :to="`/keys/${encodeURIComponent(usage.key)}`" class="truncate font-mono text-xs hover:underline">
          {{ usage.key }}
        </NuxtLink>
        <span v-else class="truncate font-mono text-xs color-muted">{{ usage.raw }}</span>
      </div>
      <ShowMore :shown="shownAll.length" :total="all.length" :step="listStep" @more="moreAll" />
    </template>
  </UiPage>
</template>
