<script setup lang="ts">
import type { ExtractSelection } from '@x18n/builtins/extractors'
import { computed, ref, watch } from 'vue'
import FilePath from '../components/FilePath.vue'
import InfoPop from '../components/InfoPop.vue'
import LocaleFlag from '../components/LocaleFlag.vue'
import MessageText from '../components/MessageText.vue'
import UiPage from '../components/ui/UiPage.vue'
import UiSection from '../components/ui/UiSection.vue'
import { t } from '../i18n'
import { backend, locales, projectName, useLive } from '../state'

const candidates = useLive((b, project) => b.extractCandidates(project))
const table = useLive((b, project) => b.keys(project))
const existing = computed(() => new Map(table.value?.rows.map(row => [row.key, row])))

interface Draft { id: string, candidate: ExtractSelection, key: string, picked: boolean }
const drafts = ref<Draft[]>([])
// Candidates reload after every extraction; keep the picks and edited keys of the strings still left.
watch(candidates, (list) => {
  const previous = new Map(drafts.value.map(d => [d.id, d]))
  const seen = new Map<string, number>()
  drafts.value = (list ?? []).map((candidate) => {
    const base = `${candidate.path}\0${candidate.original}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    const id = `${base}\0${n}`
    const before = previous.get(id)
    const key = before && before.key !== before.candidate.key
      ? before.key
      : candidate.key
    return {
      id,
      candidate,
      key,
      picked: before?.picked ?? false,
    }
  })
})

const byFile = computed(() => {
  const groups = new Map<string, Draft[]>()
  for (const draft of drafts.value) {
    const list = groups.get(draft.candidate.path) ?? []
    groups.set(draft.candidate.path, list)
    list.push(draft)
  }
  return [...groups]
})
const picked = computed(() => drafts.value.filter(d => d.picked))
const result = ref<{ count: number, files: number }>()
const busy = ref(false)

async function extract(list: readonly Draft[]): Promise<void> {
  const items = list.map(({ candidate: c, key }) => ({
    path: c.path,
    range: c.range,
    original: c.original,
    key,
    context: c.context,
  }))
  busy.value = true
  try {
    const applied = await backend.value!.extractSelected({ project: projectName.value, items })
    result.value = { count: applied.keys.length, files: applied.changes.length }
  }
  finally {
    busy.value = false
  }
}

/** The draft reuses a key whose source message is not the string's text, which extraction keeps. */
function differs(draft: Draft): boolean {
  const source = table.value?.sourceLocale
  return source !== undefined && existing.value.get(draft.key)?.values[source] !== draft.candidate.value
}
</script>

<template>
  <UiPage>
    <header class="flex items-center gap-3 border-b border-base px-4 py-3">
      <p class="flex-auto color-muted">
        {{ t('extract.hint') }}
      </p>
      <span v-if="result" class="color-ok">{{ t('extract.done', result) }}</span>
      <button v-if="backend?.capabilities.write" class="btn-solid" :disabled="!picked.length || busy" @click="extract(picked)">
        {{ t('extract.apply', { count: picked.length }) }}
      </button>
    </header>
    <p v-if="candidates && !drafts.length" class="px-4 py-3 color-muted">
      {{ t('extract.none') }}
    </p>
    <UiSection v-for="([path, list], i) in byFile" :key="path" :index="String(i + 1).padStart(2, '0')" :title="t('extract.strings', { count: list.length })">
      <template #aside>
        <FilePath :path="path" class="ml-2 flex-auto" />
        <button v-if="backend?.capabilities.write" class="btn-outline" :disabled="busy" @click="extract(list)">
          {{ t('extract.file') }}
        </button>
      </template>
      <div v-for="draft in list" :key="draft.id" class="grid grid-cols-[auto_3rem_1fr_20rem_auto] items-center gap-3 border-b border-base px-4 py-1.5 last:border-b-0">
        <label class="contents">
          <input v-model="draft.picked" type="checkbox" class="accent-[var(--x-fg)]" :disabled="!backend?.capabilities.write">
          <span class="text-right font-mono text-xs color-faint tabular-nums">{{ draft.candidate.line }}</span>
          <span class="truncate" :title="draft.candidate.text">{{ draft.candidate.text }}</span>
        </label>
        <div class="flex items-center gap-2">
          <InfoPop v-if="existing.get(draft.key)" :label="t('extract.existing')" :pinnable="false" align="left">
            <template #trigger>
              <span
                class="i-ph-link-simple-duotone shrink-0 text-base"
                :class="differs(draft) ? 'color-warn' : 'color-info'"
                role="img"
                :aria-label="t('extract.existing')"
              />
            </template>
            <p class="mb-1.5 text-xs color-muted">
              {{ t('extract.existing') }}
            </p>
            <p v-if="differs(draft)" class="mb-1.5 text-xs color-warn">
              {{ t('extract.differs') }}
            </p>
            <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <template v-for="locale in locales" :key="locale.code">
                <span class="flex items-center gap-1.5 font-mono"><LocaleFlag :code="locale.code" />{{ locale.code }}</span>
                <MessageText :value="existing.get(draft.key)?.values[locale.code]" />
              </template>
            </div>
          </InfoPop>
          <span v-else class="i-ph-plus-circle-duotone shrink-0 text-base color-ok" role="img" :title="t('extract.new')" :aria-label="t('extract.new')" />
          <input v-model="draft.key" class="input min-w-0 flex-auto font-mono text-xs" :readonly="!backend?.capabilities.write" :aria-label="t('extract.key')">
        </div>
        <button v-if="backend?.capabilities.write" class="btn-icon" :disabled="busy || !draft.key" :title="t('extract.one')" :aria-label="t('extract.one')" @click="extract([draft])">
          <span class="i-ph-hammer-duotone text-base" />
        </button>
      </div>
    </UiSection>
  </UiPage>
</template>
