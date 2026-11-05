/** A group of pages in a tab's sidebar, such as the Vue presets. */
export interface PageGroup {
  label: string
  icon?: string
  /** Classes for a one-color logo when it shows its colors, such as `text-highlighted` for Next.js. */
  iconClass?: string
  /** Last path segments of the pages, such as `vue-i18n`. */
  pages: string[]
}

/** Presets of no ecosystem: plain links above the groups in the sidebar, in this order, and a table of their own on the page after `intro`. */
export const ungroupedPresets = {
  intro: '`general` applies to every project, after the others:',
  pages: ['general'],
}

/**
 * The presets grouped by ecosystem, as the guide lists them. The Presets sidebar shows these groups, and
 * `scripts/generate.ts` writes the tables of `content/4.presets/index.md` from them; its check fails when a preset
 * page is in no group or in two, or when a name matches no page. Outside `app/`, so Nuxt does not auto-import it.
 */
export const presetGroups: PageGroup[] = [
  {
    label: 'Vue',
    icon: 'i-logos-vue',
    pages: [
      'vue-i18n',
      'fluent-vue',
      'laravel-vue-i18n',
    ],
  },
  {
    label: 'Nuxt',
    icon: 'i-logos-nuxt-icon',
    pages: [
      'nuxt-i18n',
      'nuxt-i18n-micro',
    ],
  },
  {
    label: 'React',
    icon: 'i-logos-react',
    pages: [
      'i18next',
      'react-i18next',
      'i18next-shopify',
      'react-intl',
      'lingui',
      'fluent-react',
    ],
  },
  {
    label: 'Next.js',
    icon: 'i-simple-icons-nextdotjs',
    iconClass: 'text-highlighted',
    pages: [
      'next-intl',
      'next-translate',
      'next-international',
    ],
  },
  {
    label: 'Angular',
    icon: 'i-logos-angular-icon',
    pages: [
      'angular-localize',
      'ngx-translate',
      'transloco',
      'angular-i18next',
    ],
  },
  {
    label: 'Svelte',
    icon: 'i-logos-svelte-icon',
    pages: [
      'svelte-i18n',
      'svelte-i18next',
    ],
  },
  {
    label: 'Other JavaScript',
    icon: 'i-logos-javascript',
    pages: [
      'paraglide',
      'solid-primitives-i18n',
      'lit-localize',
      'typesafe-i18n',
      'gravity-ui-i18n',
      'adonisjs',
      'ember-intl',
      'polyglot',
      'globalize',
      'i18n-tag',
      'ruby-i18n-js',
      'ui5',
    ],
  },
  {
    label: 'Extensions',
    icon: 'i-ph-puzzle-piece-duotone',
    pages: [
      'chrome-extension',
      'vscode-extension',
    ],
  },
  {
    label: 'Mobile',
    icon: 'i-ph-device-mobile-duotone',
    pages: [
      'flutter',
      'easy-localization',
      'flutter-translate',
      'android-strings',
    ],
  },
  {
    label: 'PHP',
    icon: 'i-logos-php',
    pages: [
      'laravel',
      'php-joomla',
      'php-gettext',
    ],
  },
  {
    label: 'Ruby',
    icon: 'i-logos-ruby',
    pages: [
      'ruby-rails',
      'jekyll',
    ],
  },
  {
    label: 'Python',
    icon: 'i-logos-python',
    pages: [
      'python-gettext',
      'i18nice',
    ],
  },
  {
    label: 'Rust and .NET',
    icon: 'i-ph-terminal-window-duotone',
    pages: [
      'cargo-i18n',
      'dotnet-resx',
    ],
  },
]
