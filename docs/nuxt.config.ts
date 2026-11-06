import process from 'node:process'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',

  /**
   * Develop against a local checkout of the layer:
   * COMARK_DOCS_LAYER=../../comark-docs pnpm docs
   */
  extends: [process.env.COMARK_DOCS_LAYER || 'comark-docs'],

  site: {
    url: 'https://x18n.dev',
    name: 'x18n',
  },

  llms: {
    domain: 'https://x18n.dev',
    title: 'x18n',
    description: 'Manage and view i18n files of any project, for humans and agents: a core engine, CLI, language server, VS Code extension and UI.',
  },

  devtools: { enabled: false },

  // One hand-made card (`public/og.png`, rendered from `/og`) replaces the layer's per-page Satori images.
  ogImage: { enabled: false },

  icon: {
    // Collections the demos use beyond the layer's. Served from `/api/_nuxt_icon`, because the
    // locale flags are built from data (`i-circle-flags-${flag}`), as are the presets sidebar's group
    // icons (`preset-groups.ts`; the layer already serves `logos` and `simple-icons`), and the client bundle scan misses them.
    serverBundle: {
      collections: [
        'bxl',
        'catppuccin',
        'circle-flags',
        'ph',
      ],
    },
  },

  hooks: {
    // Markdown resolves components by name at runtime, so the ones it uses must be global.
    'components:extend': (components) => {
      for (const component of components) {
        if ([
          'X18nDemo',
          'X18nTerminal',
          'X18nFrameworks',
          'X18nIcon',
        ].includes(component.pascalName)) {
          component.global = true
        }
      }
    },
  },

  nitro: {
    // `comark` is only a transitive dep (via the layer); Nitro can't resolve it
    // from here and externalizes it as an absolute pnpm store path that is
    // missing on Vercel, so bundle it instead.
    externals: {
      inline: ['comark'],
    },
  },

  app: {
    head: {
      meta: [
        { property: 'og:image', content: 'https://x18n.dev/og.png' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:image', content: 'https://x18n.dev/og.png' },
      ],
      link: [
        { rel: 'icon', href: '/logo.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/logo.svg' },
      ],
    },
  },
})
