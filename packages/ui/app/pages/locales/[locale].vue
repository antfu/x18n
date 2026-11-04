<script setup lang="ts">
import { computed } from 'vue'
import { NuxtLink } from '#components'
import { useRoute } from '#imports'
import { localeProblemCodes } from '../../../src/node/constants'
import CopyPrompt from '../../components/CopyPrompt.vue'
import LocaleFlag from '../../components/LocaleFlag.vue'
import MessageText from '../../components/MessageText.vue'
import ShowMore from '../../components/ShowMore.vue'
import UiPage from '../../components/ui/UiPage.vue'
import UiSection from '../../components/ui/UiSection.vue'
import { useDiagnostics } from '../../diagnostics'
import { formatPercent, languageName, t } from '../../i18n'
import { translatePrompt } from '../../prompt'
import { listStep, useShowMore } from '../../show-more'
import { currentProject, isLocaleVisible, toggleLocale, useLive } from '../../state'

const route = useRoute()
const code = computed(() => String(route.params.locale))
const summary = computed(() => currentProject.value?.locales.find(l => l.code === code.value))
const isSource = computed(() => code.value === currentProject.value?.sourceLocale)

const table = useLive((b, project) => b.keys(project))
const { data: problemList, more: loadMoreProblems } = useDiagnostics(() => ({ codes: localeProblemCodes, locale: code.value }))

const missing = computed(() => (table.value?.rows ?? []).filter(r => r.missing.includes(code.value) && r.values[code.value] === undefined))
const empty = computed(() => (table.value?.rows ?? []).filter(r => r.missing.includes(code.value) && r.values[code.value] !== undefined))
const outdated = computed(() => (table.value?.rows ?? []).filter(r => r.outdated.includes(code.value)))
const outdatedPercent = computed(() => summary.value && summary.value.total
  ? (summary.value.outdated / summary.value.total) * 100
  : 0)
const problems = computed(() => problemList.value?.items ?? [])
const { shown: shownMissing, more: moreMissing } = useShowMore(missing, () => code.value)
const { shown: shownEmpty, more: moreEmpty } = useShowMore(empty, () => code.value)
const { shown: shownOutdated, more: moreOutdated } = useShowMore(outdated, () => code.value)

function showInGrid(): void {
  if (!isLocaleVisible(code.value))
    toggleLocale(code.value)
}
</script>

<template>
  <UiPage>
    <header class="grid gap-4 border-b border-base px-4 py-5">
      <div class="flex items-end gap-3">
        <div class="grid gap-1">
          <span class="label">{{ t('locale.label') }}</span>
          <h1 class="flex items-center gap-3 font-mono text-2xl font-medium">
            <LocaleFlag :code="code" />
            {{ code }}
          </h1>
        </div>
        <span v-if="summary" class="pb-1 color-muted">{{ languageName(code) ?? summary.displayName }}</span>
        <span v-if="isSource" class="badge mb-1.5">{{ t('overview.source') }}</span>
        <span class="flex-auto" />
        <NuxtLink :to="{ path: '/keys', query: { missing: code } }" class="btn-outline" @click="showInGrid">
          <span class="i-ph-table-duotone" /> {{ t('locale.openInGrid') }}
        </NuxtLink>
        <CopyPrompt v-if="!isSource" :text="translatePrompt([{ locale: code, stale: outdated.length > 0 }])" :label="outdated.length ? t('prompt.copyStale') : t('prompt.copy')" :hint="outdated.length ? t('prompt.staleHint') : t('prompt.hint')" />
      </div>
      <div v-if="summary" class="grid gap-1.5">
        <span class="h-2 flex border border-strong">
          <span class="h-full bg-inverse" :style="{ width: `${Math.max(0, summary.percent - outdatedPercent)}%` }" />
          <span class="h-full bg-[var(--x-warn)]" :style="{ width: `${outdatedPercent}%` }" />
        </span>
        <span class="font-mono text-xs color-muted tabular-nums">{{ t('locale.progress', { translated: summary.translated, total: summary.total, percent: formatPercent(summary.percent) }) }}</span>
      </div>
      <p v-else-if="currentProject" class="color-muted">
        {{ t('locale.notFound') }}
      </p>
    </header>

    <UiSection v-if="missing.length" index="01" :title="t('locale.missing', { count: missing.length })">
      <NuxtLink v-for="row in shownMissing" :key="row.key" :to="`/keys/${encodeURIComponent(row.key)}`" class="focus-ring grid grid-cols-[minmax(0,20rem)_1fr] items-baseline gap-4 border-b border-base px-4 py-1.5 transition-colors last:border-b-0 hover:bg-hover">
        <span class="truncate font-mono text-xs">{{ row.key }}</span>
        <span class="truncate color-muted"><MessageText :value="row.values[currentProject?.sourceLocale ?? '']" inline /></span>
      </NuxtLink>
      <ShowMore :shown="shownMissing.length" :total="missing.length" :step="listStep" @more="moreMissing" />
    </UiSection>

    <UiSection v-if="empty.length" index="02" :title="t('locale.empty', { count: empty.length })">
      <NuxtLink v-for="row in shownEmpty" :key="row.key" :to="`/keys/${encodeURIComponent(row.key)}`" class="focus-ring grid grid-cols-[minmax(0,20rem)_1fr] items-baseline gap-4 border-b border-base px-4 py-1.5 transition-colors last:border-b-0 hover:bg-hover">
        <span class="truncate font-mono text-xs">{{ row.key }}</span>
        <span class="truncate color-muted"><MessageText :value="row.values[currentProject?.sourceLocale ?? '']" inline /></span>
      </NuxtLink>
      <ShowMore :shown="shownEmpty.length" :total="empty.length" :step="listStep" @more="moreEmpty" />
    </UiSection>

    <UiSection v-if="outdated.length" index="03" :title="t('locale.outdated', { count: outdated.length })">
      <NuxtLink v-for="row in shownOutdated" :key="row.key" :to="`/keys/${encodeURIComponent(row.key)}`" class="focus-ring grid grid-cols-[minmax(0,20rem)_1fr_1fr] items-center gap-4 border-b border-base px-4 py-1.5 transition-colors last:border-b-0 hover:bg-hover">
        <span class="flex min-w-0 items-center gap-2 font-mono text-xs">
          <span class="i-ph-clock-counter-clockwise-duotone shrink-0 color-warn" />
          <span class="truncate">{{ row.key }}</span>
        </span>
        <span class="truncate"><MessageText :value="row.values[currentProject?.sourceLocale ?? '']" inline /></span>
        <span class="truncate color-muted"><MessageText :value="row.values[code]" inline /></span>
      </NuxtLink>
      <ShowMore :shown="shownOutdated.length" :total="outdated.length" :step="listStep" @more="moreOutdated" />
    </UiSection>

    <UiSection v-if="problems.length" index="04" :title="t('locale.problems', { count: problemList?.total ?? 0 })">
      <component
        :is="d.key ? NuxtLink : 'div'"
        v-for="(d, i) in problems"
        :key="i"
        :to="d.key ? `/keys/${encodeURIComponent(d.key)}` : undefined"
        class="flex items-center gap-2 border-b border-base px-4 py-1.5 last:border-b-0"
        :class="d.key && 'transition-colors hover:bg-hover'"
      >
        <span :class="d.severity === 'error' ? 'i-ph-x-circle-duotone color-error' : 'i-ph-warning-duotone color-warn'" />
        <span class="font-mono text-xs color-muted">{{ d.code }}</span>
        <span v-if="d.key" class="font-mono text-xs">{{ d.key }}</span>
        <span class="flex-auto truncate">{{ d.message }}</span>
      </component>
      <ShowMore v-if="problemList" :shown="problems.length" :total="problemList.total" :step="problemList.pageSize" @more="loadMoreProblems" />
    </UiSection>

    <p v-if="summary && table && !missing.length && !empty.length && !outdated.length && !problems.length" class="flex items-center gap-2 px-4 py-3 color-ok">
      <span class="i-ph-check-circle-duotone" /> {{ t('locale.complete') }}
    </p>
  </UiPage>
</template>
