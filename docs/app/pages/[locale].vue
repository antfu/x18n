<script setup lang="ts">
// The landing page of a translated locale (`content/<slug>/index.md`). The layer's `pages/index.vue`
// renders only `/`, and its `[...slug]` page would render the landing markdown as a docs page.
import Button from '@nuxt/ui/components/Button.vue'
import { LandingCta, LandingFaq, LandingFeatureCard, LandingFeatures, LandingHero, LandingHeroDemo, LandingStack, LandingTabs } from '#components'

definePageMeta({
  // The slugs of `utils/locales.ts`, other than English.
  path: '/:locale(zh-hans|zh-hant|ja|ko|ru|fr|de|it|pt-br|es)',
})

const landingComponents = {
  Button,
  LandingCta,
  LandingFaq,
  LandingFeatureCard,
  LandingFeatures,
  LandingHero,
  LandingHeroDemo,
  LandingStack,
  LandingTabs,
}

const route = useRoute()
const content = useDocsContent()
const site = useSiteConfig()
const path = `/${route.params.locale as string}`

const { data: page } = await useAsyncData(`${content.value.routeBase}:landing:${path}`, () => content.value.client.get(path))
if (!page.value)
  throw createError({ statusCode: 404, statusMessage: 'Landing page not found', fatal: true })

const fm = computed<Record<string, any>>(() => page.value?.data ?? {})

useSeoMeta({
  titleTemplate: '',
  title: () => fm.value.seo?.title || fm.value.title,
  ogTitle: () => fm.value.seo?.title || fm.value.title,
  description: () => fm.value.seo?.description || fm.value.description,
  ogDescription: () => fm.value.seo?.description || fm.value.description,
  ogUrl: `${site.url}${path}`,
})
</script>

<template>
  <MarkdownDocument
    v-if="page"
    :value="page"
    :components="landingComponents"
  />
</template>
