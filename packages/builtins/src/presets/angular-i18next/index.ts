import type { Preset } from '@x18n/core'
import type { ProjectFacts } from './scanner'
import { createLibraryPlugin } from '@x18n/core'
import { i18nextCliPlugin } from '../i18next/cli-config'
import { i18nextArgs, i18nextPlugin } from '../i18next/plugin'
import { htmlTemplates } from '../shared/angular-templates'
import { scanProject } from './project-scan'
import { angularI18nextScanner } from './scanner'

export function angularI18next(): Preset {
  const facts: ProjectFacts = {
    scopes: new Map(),
    spans: new Map(),
    titles: false,
  }
  return {
    name: 'angular-i18next',
    plugins: [
      i18nextPlugin,
      i18nextCliPlugin,
      createLibraryPlugin({
        name: 'x18n:angular-i18next',
        calls: [
          {
            callee: [
              'i18NextService.t',
              'i18nextService.t',
              'translationService.t',
              'i18NextService.exists',
              'i18nextService.exists',
              'translationService.exists',
              'i18NextPipe.transform',
              'i18nextPipe.transform',
            ],
            namespace: { arg: 1, property: 'ns' },
            ...i18nextArgs,
          },
          {
            callee: ['i18NextService.getFixedT', 'i18nextService.getFixedT', 'translationService.getFixedT'],
            factory: true,
            returns: ['t'],
            namespace: { arg: 1 },
            keyPrefix: { arg: 2 },
            ...i18nextArgs,
          },
        ],
        extra: async (draft, ctx) => {
          const { validation, fallback, services } = await scanProject(ctx.host, facts)
          draft.usage = {
            ...draft.usage,
            keysInUse: [
              ...draft.usage.keysInUse,
              ...validation,
            ],
            calls: [
              ...draft.usage.calls,
              ...services.length
                ? [
                    {
                      callee: services.map(name => `${name}.getFixedT`),
                      factory: true,
                      returns: ['t'],
                      namespace: { arg: 1 },
                      keyPrefix: { arg: 2 },
                      ...i18nextArgs,
                    },
                  ]
                : [],
            ],
          }
          // The library tries each provided namespace, then the key as written, which is the default namespace.
          const defaultNamespace = draft.namespace.default
          if ((facts.scopes.size || facts.spans.size) && !ctx.user.namespace?.fallback) {
            draft.namespace = {
              ...draft.namespace,
              fallback: [
                ...new Set([
                  ...draft.namespace.fallback ?? [],
                  ...fallback,
                  ...defaultNamespace
                    ? [defaultNamespace]
                    : [],
                ]),
              ],
            }
          }
        },
        resources: [
          { pattern: 'src/locales/{locale}.{namespaces}.json' },
          { pattern: 'src/locales/{locale}/{namespaces}.json' },
          { pattern: 'src/assets/locales/{locale}.{namespaces}.json' },
          { pattern: 'src/assets/locales/{locale}/{namespaces}.json' },
          { pattern: 'public/locales/{locale}.{namespaces}.json' },
          { pattern: 'public/locales/{locale}/{namespaces}.json' },
        ],
        templates: [
          {
            template: '{{ \'{key}\' | i18next }}',
            kinds: ['html-text'],
          },
          {
            template: '[{attr}]="\'{key}\' | i18next"',
            kinds: ['html-attribute'],
          },
          {
            template: 'this.i18NextService.t(\'{key}\'{args})',
            kinds: ['js-string', 'js-template'],
          },
        ],
      }),
      {
        name: 'x18n:angular-i18next-scanner',
        scanners: [
          angularI18nextScanner(facts),
        ],
      },
      htmlTemplates(),
    ],
  }
}

export default angularI18next
