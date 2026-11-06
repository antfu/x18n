import pkg from '../../packages/cli/package.json'
import { presetGroups, ungroupedPresets } from '../preset-groups'

export default defineAppConfig({
  header: {
    title: 'x18n',
    nav: [
      {
        label: 'Guide',
        sections: ['guide', 'migration'],
      },
      {
        label: 'Surfaces',
        sections: ['surfaces'],
      },
      {
        label: 'Agents',
        sections: ['agents'],
      },
      {
        label: 'Presets',
        sections: ['presets'],
        link: 'section' as const,
        // The sidebar groups presets by ecosystem; see `preset-groups.ts`.
        groups: presetGroups,
        ungrouped: ungroupedPresets.pages,
      },
      {
        label: 'Plugins',
        sections: ['plugins'],
        link: 'section' as const,
      },
      {
        label: 'Reference',
        sections: ['references', 'checks', 'errors'],
        children: [
          { label: 'References', to: '/references/config', activePath: '/references' },
          { label: 'Checks', to: '/checks', activePath: '/checks' },
          { label: 'Errors', to: '/errors', activePath: '/errors' },
        ],
      },
      {
        label: `v${pkg.version}`,
        to: 'https://github.com/x18n-dev/x18n/releases',
        children: [
          { label: 'Release notes', to: 'https://github.com/x18n-dev/x18n/releases' },
          { label: 'Migration', to: '/migration' },
        ],
      },
    ],
    links: [
      {
        'icon': 'i-simple-icons-github',
        'to': 'https://github.com/x18n-dev/x18n',
        'target': '_blank',
        'aria-label': 'x18n on GitHub',
      },
    ],
  },

  github: {
    owner: 'x18n-dev',
    name: 'x18n',
    branch: 'main',
    contentDir: 'docs/content',
  },

  docs: {
    llms: {
      description: 'x18n reads, checks and edits the i18n locale files of a project. Use it to find missing, unused and broken translation keys (`x18n check`), to add, rename and delete keys without editing locale files by hand, to translate missing messages with an agent, and to extract hard-coded strings.',
    },
  },
})
