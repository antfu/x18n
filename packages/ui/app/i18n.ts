import { ref, shallowRef, watchEffect } from 'vue'
import en from './locales/en.json'

type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type MessageKey = Paths<typeof en>

interface Tree { readonly [segment: string]: string | Tree }

function flatten(tree: Tree, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [segment, value] of Object.entries(tree)) {
    if (typeof value === 'string')
      out.set(`${prefix}${segment}`, value)
    else
      flatten(value, `${prefix}${segment}.`, out)
  }
  return out
}

/** The UI's own languages; each has `locales/<code>.json`, which `x18n check --strict` keeps complete. */
export const uiLocales = [
  'en',
  'zh-Hans',
  'zh-Hant',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'pt-BR',
  'ru',
  'tr',
] as const
type UiLocale = typeof uiLocales[number]

const loaders = import.meta.glob<Tree>(['./locales/*.json', '!./locales/en.json'], { import: 'default' })
const fallback = flatten(en)

const STORAGE_KEY = 'x18n:lang'

export const uiLocale = ref<UiLocale>('en')
const messages = shallowRef(fallback)

/** The best UI locale for a BCP 47 tag, as browsers and VS Code (`zh-tw`, `pt-br`) write them. */
function matchUiLocale(tag: string): UiLocale | undefined {
  let locale: Intl.Locale
  try {
    locale = new Intl.Locale(tag).maximize()
  }
  catch {
    return undefined
  }
  if (locale.language === 'zh') {
    return locale.script === 'Hant'
      ? 'zh-Hant'
      : 'zh-Hans'
  }
  if (locale.language === 'pt')
    return 'pt-BR'
  return uiLocales.find(code => code === locale.language)
}

/** The language's own name for itself, for the picker. */
export function endonym(code: UiLocale): string {
  return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
}

/** `?lang=` (the VS Code panel sets it) wins, then the visitor's pick, then the browser's languages. */
export function setupI18n(): void {
  const tags = [
    new URLSearchParams(location.search).get('lang'),
    localStorage.getItem(STORAGE_KEY),
    ...navigator.languages,
  ]
  uiLocale.value = tags.map(tag => tag
    ? matchUiLocale(tag)
    : undefined).find(code => code !== undefined) ?? 'en'
  watchEffect(async () => {
    const code = uiLocale.value
    document.documentElement.lang = code
    const tree = code === 'en'
      ? undefined
      : await loaders[`./locales/${code}.json`]?.()
    if (code === uiLocale.value) {
      messages.value = tree
        ? flatten(tree)
        : fallback
    }
  })
}

export function pickUiLocale(code: UiLocale): void {
  uiLocale.value = code
  localStorage.setItem(STORAGE_KEY, code)
}

/** Reactive: reads the current UI locale, falling back to English for a message it lacks. */
export function t(key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string {
  const text = messages.value.get(key) ?? fallback.get(key) ?? key
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined
      ? match
      : typeof value === 'number'
        ? value.toLocaleString(uiLocale.value)
        : value
  })
}

/** `68.7` as the UI locale writes a percentage: `68.7%`, `68,7 %`. */
export function formatPercent(percent: number): string {
  return (percent / 100).toLocaleString(uiLocale.value, { style: 'percent', maximumFractionDigits: 1 })
}

/** A project locale's name in the UI locale; undefined for a code `Intl` does not know. */
export function languageName(code: string): string | undefined {
  try {
    return new Intl.DisplayNames([uiLocale.value], { type: 'language' }).of(code)
  }
  catch {
    return undefined
  }
}

const timeUnits = [
  ['year', 31_536e6],
  ['month', 2_592e6],
  ['week', 6_048e5],
  ['day', 864e5],
  ['hour', 36e5],
  ['minute', 6e4],
] as const

/** "3 weeks ago" in the UI language. */
export function formatAgo(at: number): string {
  const diff = at - Date.now()
  const [unit, size] = timeUnits.find(([, size]) => Math.abs(diff) >= size) ?? ['second', 1000]
  return new Intl.RelativeTimeFormat(uiLocale.value, { numeric: 'auto' }).format(Math.round(diff / size), unit)
}
