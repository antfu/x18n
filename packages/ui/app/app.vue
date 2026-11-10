<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NuxtLink, NuxtPage } from '#components'
import { useHead, useRoute } from '#imports'
import { pendingAuth, useBackend } from './backend'
import LanguageMenu from './components/LanguageMenu.vue'
import LocaleBar from './components/LocaleBar.vue'
import LogoMark from './components/LogoMark.vue'
import NavTabs from './components/NavTabs.vue'
import { setupI18n, t } from './i18n'
import { backend, currentProject, projectList, projectName, recentKeys, revision } from './state'
import { setupTheme } from './theme'

const nav = computed<{ to: string, label: string, count?: number }[]>(() => [
  {
    to: '/',
    label: t('nav.overview'),
  },
  {
    to: '/keys',
    label: t('nav.keys'),
  },
  {
    to: '/usages',
    label: t('nav.usages'),
  },
  ...currentProject.value?.reviews === undefined
    ? []
    : [
        {
          to: '/reviews',
          label: t('nav.reviews'),
          count: currentProject.value.reviews,
        },
      ],
  {
    to: '/extract',
    label: t('nav.extract'),
  },
  {
    to: '/project',
    label: t('nav.project'),
  },
])

// `Keys · my-app · x18n`: the page, then the project when there is a choice of projects.
const route = useRoute()
useHead({
  title: computed(() => {
    const page = nav.value.filter(item => item.to === '/'
      ? route.path === '/'
      : route.path.startsWith(item.to)).at(-1)?.label
    const project = (projectList.value?.projects.length ?? 0) > 1
      ? projectName.value
      : undefined
    return [
      page,
      project,
      t('app.name'),
    ].filter(Boolean).join(' · ')
  }),
})

const error = ref<string>()
const code = ref('')
const codeRejected = ref(false)

async function submitCode(): Promise<void> {
  codeRejected.value = !(await pendingAuth.value?.(code.value.trim()))
}

async function refreshProjects(): Promise<void> {
  const list = await backend.value!.project()
  projectList.value = list
  if (!list.projects.some(p => p.name === projectName.value))
    projectName.value = list.projects[0]?.name
}

setupTheme()
setupI18n()
onMounted(async () => {
  try {
    const b = await useBackend()
    backend.value = b
    await refreshProjects()
    b.onChange((state) => {
      recentKeys.value = state.changedKeys
      revision.value++
      void refreshProjects()
    })
  }
  catch (e) {
    error.value = e instanceof Error
      ? e.message
      : String(e)
  }
})
</script>

<template>
  <div class="h-full flex flex-col bg-base color-base font-sans text-sm">
    <header class="shrink-0 border-b border-base">
      <div class="h-12 flex items-center gap-6 border-b border-base px-4">
        <NuxtLink to="/" class="focus-ring flex shrink-0 items-center gap-2.5 font-mono text-sm font-medium">
          <LogoMark class="size-6 shrink-0" />
          {{ t('app.name') }}
        </NuxtLink>
        <!-- Longer labels (Turkish, German) in a narrow panel scroll here, not the whole page. -->
        <NavTabs :items="nav" />
        <div class="flex-auto" />
        <span v-if="backend?.mode === 'static'" class="badge" :title="t('app.staticHint')">{{ t('app.static') }}</span>
        <label v-if="(projectList?.projects.length ?? 0) > 1" class="flex items-center gap-2">
          <span class="label">{{ t('app.project') }}</span>
          <select v-model="projectName" class="input font-mono text-xs">
            <option v-for="p in projectList?.projects" :key="p.name" :value="p.name">
              {{ p.name }}
            </option>
          </select>
        </label>
        <LanguageMenu />
      </div>
      <LocaleBar v-if="projectName && !pendingAuth" />
    </header>

    <main class="flex-auto min-h-0 of-auto">
      <form v-if="pendingAuth" class="max-w-sm mx-auto mt-20 flex flex-col gap-4" @submit.prevent="submitCode">
        <span class="label">{{ t('auth.label') }}</span>
        <h1 class="text-2xl font-semibold tracking-tight">
          {{ t('auth.title') }}
        </h1>
        <p class="color-muted">
          {{ t('auth.hint') }}
        </p>
        <input v-model="code" class="input h-11 font-mono text-lg tracking-[0.4em]" inputmode="numeric" autocomplete="one-time-code" :aria-label="t('auth.code')" autofocus>
        <p v-if="codeRejected" class="color-error">
          {{ t('auth.rejected') }}
        </p>
        <button class="btn-solid self-start" type="submit">
          {{ t('auth.submit') }}
        </button>
      </form>
      <p v-else-if="error" class="p-4 color-error">
        {{ t('app.error', { message: error }) }}
      </p>
      <p v-else-if="!projectName" class="p-4 label">
        {{ t('app.loading') }}
      </p>
      <NuxtPage v-else />
    </main>
  </div>
</template>
