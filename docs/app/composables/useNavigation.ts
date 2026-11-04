import type { NavigationMenuItem } from '@nuxt/ui/components/NavigationMenu.vue'
import type { NavigationItem } from 'comark-content'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import type { DocsLocale } from '../utils/locales'
import { docsLocales, localizePath } from '../utils/locales'

export interface NavGroup {
  label: string
  /** Top-level content sections grouped under this tab. */
  sections?: string[]
  /** Where the tab links: the first leaf page of the first section (default) or the section index page. */
  link?: 'first-leaf' | 'section'
  /** Explicit target for a tab backed by an app route rather than content sections. */
  to?: string
  /** Path prefix that marks a manual tab active; defaults to `to`. */
  activePath?: string
  /** Dropdown items for a manual tab. */
  children?: NavGroupChild[]
}

export interface NavGroupChild {
  label: string
  to: string
  /** Path prefix that marks the child active; defaults to `to` without its query string. */
  activePath?: string
}

function firstLeaf(item: NavigationItem): string {
  let current = item
  while (current.children?.length) current = current.children[0]!
  return current.path
}

/** Logical top-level segment of a path, ignoring the active version `base`. */
function segmentOf(path: string, base: string): string {
  const rel = base && path.startsWith(base)
    ? path.slice(base.length)
    : path
  return rel.split('/').filter(Boolean)[0] ?? ''
}

function childIsActive(target: string, route: RouteLocationNormalizedLoaded): boolean {
  const [path, search] = target.split('?')
  if (!route.path.startsWith(path!))
    return false

  for (const [key, value] of new URLSearchParams(search ?? '')) {
    const current = route.query[key]
    const currentValue = Array.isArray(current)
      ? current[0]
      : current
    if (currentValue !== value)
      return false
  }
  return true
}

// Shadows the comark-docs layer's composable: a tab with `sections` may also
// carry `children`, so it shows a dropdown and still drives the sidebar, and
// each locale gets its own tabs and sidebar (see `utils/locales.ts`).

/** The `header.nav` groups from app.config; defaults to one tab per top-level navigation node. */
function navGroups(navigation: NavigationItem[], base: string): NavGroup[] {
  const { header } = useAppConfig()
  const groups = (header?.nav ?? []) as NavGroup[]
  if (groups.length)
    return groups

  return navigation.map(item => ({
    label: item.title,
    sections: [
      segmentOf(item.path, base),
    ],
  }))
}

/**
 * The navigation of the active locale: the children of its `/<slug>` node, or, for English, the tree
 * without the translated locales.
 */
function localeNavigation(navigation: NavigationItem[], routeBase: string, locale: DocsLocale): NavigationItem[] {
  if (locale.slug)
    return navigation.find(item => item.path === `${routeBase}/${locale.slug}`)?.children ?? []
  const translated = new Set(docsLocales.filter(l => l.slug).map(l => `${routeBase}/${l.slug}`))
  return navigation.filter(item => !translated.has(item.path))
}

/** An internal link of a manual tab, in the active locale. */
function localeLink(to: string, locale: DocsLocale): string {
  return to.startsWith('http')
    ? to
    : localizePath(to, locale)
}

/** High-level navbar items, one per configured nav group (plus GitHub and the locale switch). */
export function useMainNavigation(): ComputedRef<NavigationMenuItem[]> {
  const route = useRoute()
  const content = useDocsContent()
  const active = useDocsLocale()
  const { github } = useAppConfig()
  const navigation = inject<Ref<NavigationItem[]>>('navigation', ref([]))

  return computed<NavigationMenuItem[]>(() => {
    const { locale, base } = active.value
    const label = (text: string): string => locale.labels?.[text] ?? text
    const nav = localeNavigation(navigation.value ?? [], content.value.routeBase, locale)
    const seg = segmentOf(route.path, base)

    const bySegment = new Map<string, NavigationItem>()
    for (const item of nav) bySegment.set(segmentOf(item.path, base), item)

    const items: NavigationMenuItem[] = []

    for (const group of navGroups(nav, base)) {
      // Manual tab: an explicit app-route link, optionally with a dropdown.
      const node = group.sections?.map(s => bySegment.get(s)).find(Boolean)
      if (!group.to && !node)
        continue
      const to = group.to
        ? localeLink(group.to, locale)
        : group.link === 'section'
          ? node!.path
          : firstLeaf(node!)
      items.push({
        label: label(group.label),
        to,
        active: group.sections?.length
          ? group.sections.includes(seg)
          : seg === segmentOf(localeLink(group.activePath ?? group.to!, locale), base),
        ...(group.children?.length && {
          children: group.children.map((child) => {
            const childTo = localeLink(child.to, locale)
            return {
              label: label(child.label),
              to: childTo,
              target: child.to.startsWith('http')
                ? '_blank'
                : undefined,
              active: !child.to.startsWith('http') && childIsActive(child.activePath
                ? localeLink(child.activePath, locale)
                : childTo, route),
            }
          }),
        }),
      })
    }

    items.push({
      label: locale.name,
      icon: 'i-ph-translate',
      children: active.value.alternates.map(alternate => ({
        label: alternate.locale.name,
        to: alternate.to,
        active: alternate.locale.code === locale.code,
      })),
    })

    const githubUrl
      = github?.url || (github?.owner && github?.name
        ? `https://github.com/${github.owner}/${github.name}`
        : '')
    if (githubUrl) {
      items.push({
        label: 'GitHub',
        to: githubUrl,
        target: '_blank',
      })
    }

    return items
  })
}

/** The sidebar tree for the active tab. */
export function useFilteredNavigation(): ComputedRef<NavigationItem[]> {
  const route = useRoute()
  const content = useDocsContent()
  const active = useDocsLocale()
  const navigation = inject<Ref<NavigationItem[]>>('navigation', ref([]))

  return computed<NavigationItem[]>(() => {
    const { locale, base } = active.value
    const seg = segmentOf(route.path, base)
    const nav = localeNavigation(navigation.value ?? [], content.value.routeBase, locale)

    const groups = navGroups(nav, base)
    const activeGroup = groups.find(group => group.sections?.includes(seg)) ?? groups[0]
    const sections = activeGroup?.sections
    // Manual tabs (no sections) have no content sidebar; fall back to the full tree.
    if (!sections?.length)
      return nav

    // Single-section tab: that section's children as a flat tree.
    if (sections.length === 1) {
      const node = nav.find(item => segmentOf(item.path, base) === sections[0])
      return (node?.children ?? []).filter(child => child.path !== node?.path)
    }

    // Multi-section tab: the sections as collapsible groups.
    return nav.filter(item => sections.includes(segmentOf(item.path, base)))
  })
}
