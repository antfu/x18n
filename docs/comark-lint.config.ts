import preset from 'comark-docs/lint.mjs'

export default {
  ...preset,
  components: [
    ...preset.components,
    // The site's own Markdown components, made global by the `components:extend` hook in `nuxt.config.ts`.
    'x18n-demo',
    'x18n-frameworks',
    'x18n-terminal',
  ],
}
