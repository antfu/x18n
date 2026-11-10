<script setup lang="ts">
import type { Fix, MessageLeaf } from '@x18n/core'
import type { UiEditOp, UsageView } from '../../../src/node/types'
import { computed, ref } from 'vue'
import { NuxtLink } from '#components'
import { useRoute } from '#imports'
import ChangeInfo from '../../components/ChangeInfo.vue'
import CodeSnippet from '../../components/CodeSnippet.vue'
import CopyPrompt from '../../components/CopyPrompt.vue'
import FilePath from '../../components/FilePath.vue'
import InfoPop from '../../components/InfoPop.vue'
import KeySidebar from '../../components/KeySidebar.vue'
import LocaleFlag from '../../components/LocaleFlag.vue'
import MessageEditor from '../../components/MessageEditor.vue'
import MessageText from '../../components/MessageText.vue'
import ReviewComposer from '../../components/ReviewComposer.vue'
import ReviewThread from '../../components/ReviewThread.vue'
import UiSection from '../../components/ui/UiSection.vue'
import { applyEdit, describeProblem, setMessage } from '../../edit'
import { t } from '../../i18n'
import { translatePrompt } from '../../prompt'
import { messageStates, reviewStates } from '../../review'
import { backend, currentProject, locales, projectName, showAllLocales, useLive, visibleLocales } from '../../state'

const route = useRoute()
const key = computed(() => String(route.params.key))
const detail = useLive((b, project) => b.key(project, key.value))

const rows = computed(() => visibleLocales.value.map(locale => ({
  locale: locale.code,
  message: detail.value?.messages.find(m => m.locale === locale.code),
  thread: detail.value?.reviews.find(r => r.locale === locale.code),
})))
const reviewing = ref<string>()
const canReview = computed(() => backend.value?.capabilities.write === true && currentProject.value?.reviews !== undefined)
const hiddenCount = computed(() => locales.value.length - visibleLocales.value.length)
const sourceValue = computed(() => detail.value?.messages.find(m => m.locale === currentProject.value?.sourceLocale)?.value)

const editing = ref<{ locale: string, draft: string }>()
const problem = ref<string>()

async function save(force = false): Promise<void> {
  const edit = editing.value
  if (!edit)
    return
  const result = await setMessage(key.value, edit.locale, edit.draft, force)
  if (result.applied) {
    editing.value = undefined
    problem.value = undefined
  }
  else {
    problem.value = result.problems.map(describeProblem).join('; ')
  }
}

function edit(locale: string, value: MessageLeaf | undefined): void {
  editing.value = {
    locale,
    draft: value === undefined || value === null
      ? ''
      : String(value),
  }
  problem.value = undefined
}

function isUiOp(op: Fix['ops'][number]): op is UiEditOp {
  return op.type !== 'extract' && op.type !== 'format'
}

function openUsage(usage: UsageView): void {
  void backend.value?.openInEditor({
    project: projectName.value,
    path: usage.path,
    line: usage.line,
    column: usage.column,
  })
}
</script>

<template>
  <!-- 6px clear of each side, where the corner marks of the sections reach, as in `UiPage`. -->
  <div class="mx-auto h-full w-[calc(100%-0.75rem)] flex max-w-6xl border-x border-base xl:max-w-[90rem]">
    <aside class="hidden w-72 shrink-0 flex-col border-r border-base xl:flex">
      <KeySidebar />
    </aside>
    <div class="min-w-0 flex-auto of-y-auto">
      <header class="flex items-center gap-3 border-b border-base px-4 py-4">
        <NuxtLink to="/keys" class="btn-icon" :aria-label="t('detail.back')">
          <span class="i-ph-arrow-left-duotone" />
        </NuxtLink>
        <div class="grid gap-1">
          <span class="label">{{ t('detail.label') }}</span>
          <h1 class="break-all text-xl font-medium" :class="detail?.label === undefined && 'font-mono'">
            {{ detail?.label ?? key }}
          </h1>
          <span v-if="detail?.label !== undefined" class="break-all font-mono text-xs color-muted">{{ key }}</span>
        </div>
        <span v-if="detail?.namespace" class="badge self-end">{{ detail.namespace }}</span>
      </header>

      <p v-if="detail === null" class="px-4 py-3 color-muted">
        {{ t('detail.notFound') }}
      </p>

      <template v-else-if="detail">
        <UiSection index="01" :title="t('detail.values')">
          <p v-if="!rows.length" class="px-4 py-3 color-muted">
            {{ t('localeBar.noneShown') }}
          </p>
          <div v-for="row in rows" :key="row.locale" class="grid grid-cols-[7rem_1fr_auto] items-start gap-4 border-b border-base px-4 py-3 last:border-b-0" :data-locale="row.locale">
            <span class="flex flex-wrap items-center gap-2 pt-0.5 font-mono">
              <LocaleFlag :code="row.locale" />
              {{ row.locale }}
              <span v-if="row.locale === currentProject?.sourceLocale" class="badge">{{ t('overview.source') }}</span>
              <span v-if="row.message?.outdated" class="badge border-current color-warn" :title="t('history.outdatedHint')">{{ t('history.outdated') }}</span>
              <span v-if="row.message?.state" class="badge gap-1 border-current" :class="messageStates[row.message.state].color"><span :class="messageStates[row.message.state].icon" />{{ t(messageStates[row.message.state].label) }}</span>
              <span v-if="row.thread?.state" class="badge gap-1 border-current" :class="reviewStates[row.thread.state].color" :title="t(reviewStates[row.thread.state].label)"><span :class="reviewStates[row.thread.state].icon" />{{ row.thread.comments.filter(c => !c.resolved).length }}</span>
            </span>
            <MessageEditor
              v-if="editing?.locale === row.locale"
              v-model="editing.draft"
              :label="t('keys.editValue', { key, locale: row.locale })"
              :problem="problem"
              @save="save"
              @cancel="editing = undefined"
            />
            <div v-else class="grid min-w-0 gap-1" :title="backend?.capabilities.write ? t('detail.edit') : undefined" @dblclick="backend?.capabilities.write && edit(row.locale, row.message?.value)">
              <MessageText :value="row.message?.value" :placeholders="row.message?.placeholders ?? []" />
              <p v-if="row.message?.description" class="flex items-start gap-1.5 whitespace-pre-line text-xs color-muted">
                <span class="i-ph-note-duotone mt-0.5 shrink-0" :title="t('detail.description')" /><span class="sr-only">{{ t('detail.description') }}</span>{{ row.message.description }}
              </p>
              <dl v-if="row.message?.sourceThen !== undefined" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-l-2 border-[var(--x-warn)] py-0.5 pl-3 text-xs">
                <dt class="label">
                  {{ t('history.sourceThen') }}
                </dt>
                <dd class="color-muted line-through decoration-[var(--x-faint)]">
                  <MessageText :value="row.message.sourceThen" />
                </dd>
                <dt class="label">
                  {{ t('history.sourceNow') }}
                </dt>
                <dd><MessageText :value="sourceValue" /></dd>
              </dl>
            </div>
            <div class="flex gap-1">
              <button v-if="canReview" type="button" class="btn-icon h-6 w-6 text-sm" :class="reviewing === row.locale && 'bg-hover color-base'" :aria-label="t('review.add')" :title="t('review.add')" :aria-expanded="reviewing === row.locale" @click="reviewing = reviewing === row.locale ? undefined : row.locale">
                <span class="i-ph-chat-circle-text-duotone" />
              </button>
              <CopyPrompt v-if="row.locale !== currentProject?.sourceLocale" :text="translatePrompt([{ locale: row.locale, key }])" :label="t('prompt.copy')" :hint="t('prompt.hint')" />
              <InfoPop v-if="row.message" icon="i-ph-file-text-duotone" :label="t('detail.file')">
                <FilePath :path="row.message.path" :line="row.message.line" />
              </InfoPop>
              <InfoPop v-if="row.message?.changed" icon="i-ph-clock-counter-clockwise-duotone" :label="t('history.title')">
                <ChangeInfo :change="row.message.changed" />
              </InfoPop>
            </div>
            <div v-if="row.thread?.comments.length || reviewing === row.locale" class="col-span-2 col-start-2 grid gap-3 pb-1">
              <ReviewThread v-if="row.thread?.comments.length" :thread="row.thread" :current="row.message?.value" />
              <ReviewComposer v-if="reviewing === row.locale" :review-key="key" :locale="row.locale" :current="row.message?.value" @close="reviewing = undefined" />
            </div>
          </div>
          <button v-if="hiddenCount" class="btn-ghost h-9 w-full justify-start px-4" @click="showAllLocales">
            <span class="i-ph-dots-three-duotone" /> {{ t('detail.showAllLocales') }} ({{ hiddenCount }})
          </button>
        </UiSection>

        <UiSection v-if="detail.diagnostics.length" index="02" :title="t('detail.diagnostics')">
          <div v-for="(d, i) in detail.diagnostics" :key="i" class="flex items-center gap-2 border-b border-base px-4 py-2 last:border-b-0">
            <span :class="d.severity === 'error' ? 'i-ph-x-circle-duotone color-error' : 'i-ph-warning-duotone color-warn'" />
            <span class="font-mono text-xs color-muted">{{ d.code }}</span>
            <span class="flex-auto">{{ d.message }}</span>
            <template v-if="backend?.capabilities.write">
              <button v-for="fix in d.fixes.filter(f => f.ops.every(isUiOp))" :key="fix.title" class="btn-outline h-7" @click="applyEdit(fix.ops.filter(isUiOp))">
                {{ fix.title }}
              </button>
            </template>
          </div>
        </UiSection>

        <UiSection index="03" :title="t('detail.usages', { count: detail.usages.length })">
          <p v-if="!detail.usages.length" class="px-4 py-3 color-muted">
            {{ t('detail.noUsages') }}
          </p>
          <div v-for="(usage, i) in detail.usages" :key="i" class="grid gap-2 border-b border-base px-4 py-3 last:border-b-0">
            <div class="flex items-center gap-2">
              <FilePath :path="usage.path" :line="usage.line" :column="usage.column" />
              <span v-if="usage.possible" class="badge">{{ t('detail.possible') }}</span>
              <span class="flex-auto" />
              <button v-if="backend?.capabilities.openInEditor" class="btn-ghost h-7" @click="openUsage(usage)">
                <span class="i-ph-arrow-square-out-duotone" /> {{ t('detail.openInEditor') }}
              </button>
            </div>
            <CodeSnippet :usage="usage" />
          </div>
        </UiSection>
      </template>
    </div>
  </div>
</template>
