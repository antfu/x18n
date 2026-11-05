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
  {
    code: 'zh-Hant',
    slug: 'zh-hant',
    name: '繁體中文',
    labels: {
      'Guide': '指南',
      'Surfaces': '介面',
      'Presets': '預設集',
      'Plugins': '外掛',
      'Reference': '參考',
      'References': '參考文件',
      'Checks': '檢查',
      'Errors': '錯誤',
      'Release notes': '發行說明',
      'Migration': '遷移',
    },
  },
  {
    code: 'ja',
    slug: 'ja',
    name: '日本語',
    labels: {
      'Guide': 'ガイド',
      'Surfaces': 'サーフェス',
      'Agents': 'エージェント',
      'Presets': 'プリセット',
      'Plugins': 'プラグイン',
      'Reference': 'リファレンス',
      'References': 'リファレンス',
      'Checks': 'チェック',
      'Errors': 'エラー',
      'Release notes': 'リリースノート',
      'Migration': '移行',
    },
  },
  {
    code: 'ko',
    slug: 'ko',
    name: '한국어',
    labels: {
      'Guide': '가이드',
      'Surfaces': '인터페이스',
      'Agents': '에이전트',
      'Presets': '프리셋',
      'Plugins': '플러그인',
      'Reference': '레퍼런스',
      'References': '레퍼런스',
      'Checks': '검사',
      'Errors': '오류',
      'Release notes': '릴리스 노트',
      'Migration': '마이그레이션',
    },
  },
  {
    code: 'ru',
    slug: 'ru',
    name: 'Русский',
    labels: {
      'Guide': 'Руководство',
      'Surfaces': 'Интерфейсы',
      'Agents': 'Агенты',
      'Presets': 'Пресеты',
      'Plugins': 'Плагины',
      'Reference': 'Справочник',
      'References': 'Справочники',
      'Checks': 'Проверки',
      'Errors': 'Ошибки',
      'Release notes': 'Примечания к выпуску',
      'Migration': 'Миграция',
    },
  },
  {
    code: 'fr',
    slug: 'fr',
    name: 'Français',
    labels: {
      'Surfaces': 'Interfaces',
      'Reference': 'Référence',
      'References': 'Références',
      'Checks': 'Vérifications',
      'Errors': 'Erreurs',
      'Release notes': 'Notes de version',
    },
  },
  {
    code: 'de',
    slug: 'de',
    name: 'Deutsch',
    labels: {
      'Guide': 'Anleitung',
      'Surfaces': 'Oberflächen',
      'Reference': 'Referenz',
      'References': 'Referenzen',
      'Checks': 'Prüfungen',
      'Errors': 'Fehler',
      'Release notes': 'Versionshinweise',
    },
  },
  {
    code: 'it',
    slug: 'it',
    name: 'Italiano',
    labels: {
      'Guide': 'Guida',
      'Surfaces': 'Interfacce',
      'Agents': 'Agenti',
      'Presets': 'Preset',
      'Plugins': 'Plugin',
      'Reference': 'Riferimenti',
      'References': 'Riferimenti',
      'Checks': 'Controlli',
      'Errors': 'Errori',
      'Release notes': 'Note di rilascio',
      'Migration': 'Migrazione',
    },
  },
  {
    code: 'pt-BR',
    slug: 'pt-br',
    name: 'Português (Brasil)',
    labels: {
      'Guide': 'Guia',
      'Surfaces': 'Interfaces',
      'Agents': 'Agentes',
      'Reference': 'Referência',
      'References': 'Referências',
      'Checks': 'Verificações',
      'Errors': 'Erros',
      'Release notes': 'Notas de versão',
      'Migration': 'Migração',
    },
  },
  {
    code: 'es',
    slug: 'es',
    name: 'Español',
    labels: {
      'Guide': 'Guía',
      'Surfaces': 'Interfaces',
      'Agents': 'Agentes',
      'Reference': 'Referencia',
      'References': 'Referencias',
      'Checks': 'Comprobaciones',
      'Errors': 'Errores',
      'Release notes': 'Notas de la versión',
      'Migration': 'Migración',
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
