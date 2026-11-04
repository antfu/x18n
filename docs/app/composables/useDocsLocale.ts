import type { DocsLocale } from '../utils/locales'
import { docsLocales, localeOf, localizePath } from '../utils/locales'

export interface ActiveLocale {
  locale: DocsLocale
  /** The version base (`/tree/<branch>` in previews) with the locale prefix. */
  base: string
  /** The route path without the version base and the locale prefix. */
  path: string
  /** The route of the current page in every locale. */
  alternates: Array<{ locale: DocsLocale, to: string }>
}

/** The locale of the current route. */
export function useDocsLocale(): ComputedRef<ActiveLocale> {
  const route = useRoute()
  const content = useDocsContent()
  return computed(() => {
    const routeBase = content.value.routeBase
    const rel = routeBase && route.path.startsWith(routeBase)
      ? route.path.slice(routeBase.length) || '/'
      : route.path
    const { locale, path } = localeOf(rel)
    return {
      locale,
      base: locale.slug
        ? `${routeBase}/${locale.slug}`
        : routeBase,
      path,
      alternates: docsLocales.map(l => ({ locale: l, to: `${routeBase}${localizePath(path, l)}` })),
    }
  })
}

/** `<html lang>` and `hreflang` alternates for the current route. */
export function useDocsLocaleHead(): void {
  const active = useDocsLocale()
  const content = useDocsContent()
  const site = useSiteConfig()
  useHead({
    htmlAttrs: {
      lang: () => active.value.locale.code,
    },
    // Previews are noindex and canonicalize to production, so they get no alternates.
    link: () => content.value.routeBase
      ? []
      : active.value.alternates.map(({ locale, to }) => ({
          rel: 'alternate',
          hreflang: locale.code,
          href: `${site.url}${to}`,
        })),
  }, {
    // `htmlAttrs` merge in priority order, the last one winning: this has to come after the
    // `lang: 'en'` of the layer's `app.vue`.
    tagPriority: 'low',
  })
}
