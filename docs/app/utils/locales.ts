/**
 * The locales of the docs. English pages live at the content root; each other locale mirrors them
 * under `content/<slug>/`, written by `docs/scripts/translate.ts` from the diglot records in `docs/i18n/`.
 */
export interface DocsLocale {
  /** BCP 47 tag, as in `docs/i18n/diglot.config.ts` and `<html lang>`. */
  code: string
  /** First path segment of the locale's pages; empty for English. */
  slug: string
  /** The locale's name in itself. */
  name: string
  /** Header tab labels, by their English label. */
  labels?: Record<string, string>
}

export const docsLocales: DocsLocale[] = [
  { code: 'en', slug: '', name: 'English' },
  {
    code: 'zh-Hans',
    slug: 'zh-hans',
    name: '简体中文',
    labels: {
      'Guide': '指南',
      'Surfaces': '界面',
      'Agents': '智能体',
      'Presets': '预设',
      'Plugins': '插件',
      'Reference': '参考',
      'References': '参考文档',
      'Checks': '检查项',
      'Errors': '错误',
      'Release notes': '发布说明',
      'Migration': '迁移',
    },
  },
]

const english = docsLocales[0]!

/** The locale of a path relative to the active version base, and the path without its locale prefix. */
export function localeOf(path: string): { locale: DocsLocale, path: string } {
  const segment = path.split('/').filter(Boolean)[0]
  const locale = docsLocales.find(l => l.slug && l.slug === segment)
  if (!locale)
    return { locale: english, path }
  return { locale, path: path.slice(locale.slug.length + 1) || '/' }
}

/** `path` (an English, unprefixed path) in `locale`. */
export function localizePath(path: string, locale: DocsLocale): string {
  if (!locale.slug || !path.startsWith('/'))
    return path
  return path === '/'
    ? `/${locale.slug}`
    : `/${locale.slug}${path}`
}
