<script setup lang="ts">
import type { ChangeGroup, LocaleSummary } from '../../src/node/types'
import { computed, ref } from 'vue'
import { NuxtLink } from '#components'
import ChangedValues from '../components/ChangedValues.vue'
import ChangeInfo from '../components/ChangeInfo.vue'
import CopyPrompt from '../components/CopyPrompt.vue'
import LocaleFlag from '../components/LocaleFlag.vue'
import UiPage from '../components/ui/UiPage.vue'
import UiSection from '../components/ui/UiSection.vue'
import UiStat from '../components/ui/UiStat.vue'
import { formatPercent, languageName, t } from '../i18n'
import { translatePrompt } from '../prompt'
import { locales, currentProject as project, recentKeys } from '../state'

function share(locale: LocaleSummary, count: number): number {
  return locale.total === 0
    ? 0
    : (count / locale.total) * 100
}

// With translation states, values not yet reviewed show lighter.
const hasStates = computed(() => (project.value?.locales ?? []).some(l => l.reviewed + l.needsReview > 0))

function bar(locale: LocaleSummary): { readonly class: string, readonly width: number }[] {
  const states = hasStates.value && locale.code !== project.value?.sourceLocale
  const reviewed = states
    ? share(locale, locale.reviewed)
    : 0
  const needsReview = share(locale, locale.needsReview)
  const outdated = share(locale, locale.outdated)
  return [
    { class: 'bg-inverse', width: reviewed },
    {
      class: states ? 'bg-[var(--x-faint)]' : 'bg-inverse',
      width: Math.max(0, locale.percent - outdated - reviewed - needsReview),
    },
    { class: 'bg-[var(--x-info)]', width: needsReview },
    { class: 'bg-[var(--x-warn)]', width: outdated },
  ]
}

// The latest revision starts open; a click on any revision flips it.
const flipped = ref(new Set<string>())

function isOpen(change: ChangeGroup, index: number): boolean {
  return (index === 0) !== flipped.value.has(change.revision ?? 'local')
}

function toggle(change: ChangeGroup): void {
  const id = change.revision ?? 'local'
  const next = new Set(flipped.value)
  if (!next.delete(id))
    next.add(id)
  flipped.value = next
}

const RECENT_LIMIT = 20
const shownRecent = computed(() => recentKeys.value.slice(0, RECENT_LIMIT))

// The title button covers every locale that has work left; with none, it says there is nothing to do.
const translatable = computed(() => (project.value?.locales ?? []).filter(l => l.code !== project.value?.sourceLocale))
const todo = computed(() => translatable.value.filter(l => l.missing + l.empty + l.outdated > 0))

const stats = computed(() => project.value && [
  {
    label: t('overview.keys'),
    value: project.value.keys,
    to: '/keys',
  },
  {
    label: t('overview.resources'),
    value: project.value.resources,
    to: '/project',
  },
  {
    label: t('overview.usages'),
    value: project.value.usages,
    to: '/usages',
  },
  {
    label: t('overview.locales'),
    value: project.value.locales.length,
    to: '/keys',
  },
])
</script>

<template>
  <UiPage v-if="project">
    <div class="grid grid-cols-2 border-b border-base md:grid-cols-4">
      <NuxtLink v-for="stat in stats" :key="stat.label" :to="stat.to" class="focus-ring border-r border-base transition-colors last:border-r-0 hover:bg-hover">
        <UiStat :label="stat.label" :value="stat.value" />
      </NuxtLink>
    </div>

    <UiSection index="01" :title="t('overview.coverage')">
      <template #aside>
        <span class="flex-auto" />
        <CopyPrompt v-if="translatable.length" :text="translatePrompt((todo.length ? todo : translatable).map(l => ({ locale: l.code, stale: l.outdated > 0 })))" :label="t('prompt.copyAll')" :hint="t('prompt.allHint')" />
      </template>
      <div v-for="locale in locales" :key="locale.code" class="flex items-center border-b border-base transition-colors last:border-b-0 hover:bg-hover">
        <NuxtLink
          :to="`/locales/${encodeURIComponent(locale.code)}`"
          class="focus-ring grid flex-auto grid-cols-[7rem_1fr_4.5rem_14rem] items-center gap-4 py-2 pl-4"
        >
          <span class="flex items-center gap-2 font-mono">
            <LocaleFlag :code="locale.code" />
            {{ locale.code }}
            <span v-if="locale.code === project.sourceLocale" class="badge">{{ t('overview.source') }}</span>
          </span>
          <span class="h-1.5 flex border border-strong" :title="languageName(locale.code)">
            <span v-for="(part, i) in bar(locale)" :key="i" class="h-full" :class="part.class" :style="{ width: `${part.width}%` }" />
          </span>
          <span class="text-right font-mono tabular-nums" :class="locale.percent >= 100 && 'color-ok'">{{ formatPercent(locale.percent) }}</span>
          <span class="text-xs color-muted tabular-nums">
            {{ t('overview.missing', { missing: locale.missing, empty: locale.empty }) }}
            <span v-if="locale.outdated" class="color-warn">· {{ t('overview.outdated', { count: locale.outdated }) }}</span>
            <span v-if="locale.needsReview" class="color-info"> · {{ t('overview.toReview', { count: locale.needsReview }) }}</span>
            <span v-if="hasStates && locale.reviewed"> · {{ t('overview.reviewedCount', { count: locale.reviewed }) }}</span>
          </span>
        </NuxtLink>
        <span class="flex w-12 shrink-0 justify-center">
          <CopyPrompt v-if="locale.code !== project.sourceLocale" :text="translatePrompt([{ locale: locale.code, stale: locale.outdated > 0 }])" :label="locale.outdated ? t('prompt.copyStale') : t('prompt.copy')" :hint="locale.outdated ? t('prompt.staleHint') : t('prompt.hint')" />
        </span>
      </div>
    </UiSection>

    <div class="grid md:grid-cols-2">
      <UiSection index="02" :title="t('overview.diagnostics')" class="md:border-r">
        <template #aside>
          <span class="flex-auto" />
          <NuxtLink to="/diagnostics" class="focus-ring font-mono text-xs color-muted hover:underline">
            {{ t('diagnostics.viewAll') }}
          </NuxtLink>
          <span class="font-mono text-xs color-error tabular-nums">{{ t('overview.errors', { count: project.diagnostics.errors }) }}</span>
          <span class="font-mono text-xs color-warn tabular-nums">{{ t('overview.warnings', { count: project.diagnostics.warnings }) }}</span>
        </template>
        <p v-if="!project.diagnostics.byCode.length" class="px-4 py-3 color-muted">
          {{ t('overview.clean') }}
        </p>
        <NuxtLink v-for="d in project.diagnostics.byCode" :key="d.code" :to="{ path: '/diagnostics', query: { code: d.code } }" class="focus-ring flex items-center gap-2 px-4 py-1.5 transition-colors hover:bg-hover">
          <span :class="d.severity === 'error' ? 'i-ph-x-circle-duotone color-error' : 'i-ph-warning-duotone color-warn'" />
          <span class="flex-auto font-mono text-xs">{{ d.code }}</span>
          <span class="font-mono tabular-nums">{{ d.count }}</span>
          <span class="i-ph-caret-right-duotone text-xs color-muted" />
        </NuxtLink>
      </UiSection>

      <div>
        <UiSection index="03" :title="t('overview.presets')">
          <div class="flex flex-wrap gap-1 px-4 py-3">
            <span v-for="preset in project.presets" :key="preset" class="border border-strong px-1.5 font-mono text-xs">{{ preset }}</span>
            <span v-if="!project.presets.length" class="color-muted">{{ t('overview.noPresets') }}</span>
          </div>
        </UiSection>
        <UiSection index="04" :title="t('overview.recent')">
          <div class="flex flex-wrap gap-1 px-4 py-3">
            <ChangedValues v-for="key in shownRecent" :key="key" :project="project.name" :key-name="key">
              <NuxtLink :to="`/keys/${encodeURIComponent(key)}`" class="focus-ring border border-base px-1.5 font-mono text-xs hover:border-inverse">
                {{ key }}
              </NuxtLink>
            </ChangedValues>
            <span v-if="!recentKeys.length" class="color-muted">{{ t('overview.noRecent') }}</span>
            <span v-else-if="recentKeys.length > RECENT_LIMIT" class="color-muted">{{ t('history.more', { count: recentKeys.length - RECENT_LIMIT }) }}</span>
          </div>
        </UiSection>
      </div>
    </div>

    <UiSection v-if="project.changes.length" index="05" :title="t('history.title')">
      <div v-for="(change, i) in project.changes" :key="change.revision ?? 'local'" class="border-b border-base last:border-b-0">
        <button type="button" class="focus-ring flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-hover" :aria-expanded="isOpen(change, i)" @click="toggle(change)">
          <span class="i-ph-caret-right-duotone shrink-0 transition-transform" :class="isOpen(change, i) && 'rotate-90'" />
          <ChangeInfo :change="change" />
          <span class="flex-auto" />
          <span class="badge" :title="t('overview.keys')">{{ change.total }}</span>
        </button>
        <div v-if="isOpen(change, i)" class="border-t border-base">
          <NuxtLink
            v-for="entry in change.keys"
            :key="entry.key"
            :to="`/keys/${encodeURIComponent(entry.key)}`"
            class="focus-ring grid grid-cols-[minmax(0,20rem)_1fr] items-center gap-4 border-b border-base py-1.5 pl-10 pr-4 transition-colors last:border-b-0 hover:bg-hover"
          >
            <span class="truncate font-mono text-xs">{{ entry.key }}</span>
            <ChangedValues :project="project.name" :key-name="entry.key" :locales="entry.locales" />
          </NuxtLink>
          <p v-if="change.total > change.keys.length" class="py-1.5 pl-10 pr-4 text-xs color-muted">
            {{ t('history.more', { count: change.total - change.keys.length }) }}
          </p>
        </div>
      </div>
    </UiSection>
  </UiPage>
</template>
