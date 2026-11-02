import type { MessageTree, Preset } from '@x18n/core'
import { createLibraryPlugin, isMessageLeaf, pathId } from '@x18n/core'
// Detection and syntax adapted from i18n-ally (MIT), src/frameworks/*
import { dollars } from '../../placeholders'

/** Chrome and WebExtension `_locales/{locale}/messages.json`: `{ "name": { "message": "...", "description": "..." } }` reads as `name`, described by `description`. */
export function chromeExtension(): Preset {
  return {
    name: 'chrome-extension',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:chrome-extension',
        calls: [
          {
            callee: ['chrome.i18n.getMessage', 'browser.i18n.getMessage', 'i18n.getMessage'],
          },
        ],
        regex: [
          {
            extensions: ['json', 'html', 'css'],
            patterns: ['__MSG_({key})__'],
          },
        ],
        resources: [
          { pattern: '_locales/{locale}/messages.json' },
          { pattern: '{src,public,extension}/_locales/{locale}/messages.json' },
        ],
        transformResource: {
          applies: ctx => /(?:^|\/)_locales\/[^/]+\/messages\.json$/.test(ctx.path),
          read(tree) {
            const out: Record<string, MessageTree[string]> = {}
            for (const [name, entry] of Object.entries(tree)) {
              const message = isMessageLeaf(entry)
                ? undefined
                : entry.message
              if (message !== undefined && isMessageLeaf(message))
                out[name] = message
            }
            return out
          },
          toStored: path => [
            path.join('.'),
            'message',
          ],
          describe(tree) {
            const descriptions = new Map<string, string>()
            for (const [name, entry] of Object.entries(tree)) {
              const description = isMessageLeaf(entry)
                ? undefined
                : entry.description
              if (typeof description === 'string' && description.trim() !== '')
                descriptions.set(pathId([name, 'message']), description)
            }
            return descriptions
          },
        },
        templates: [
          {
            template: 'chrome.i18n.getMessage(\'{key}\')',
            kinds: ['js-string', 'js-template'],
          },
        ],
        placeholders: [dollars],
      }),
      {
        name: 'x18n:chrome-extension-source-locale',
        async config(draft, ctx) {
          const manifest = await ctx.host.readFile('manifest.json') ?? await ctx.host.readFile('src/manifest.json') ?? await ctx.host.readFile('public/manifest.json')
          const locale = manifest
            ? /"default_locale"\s*:\s*"([^"]+)"/.exec(manifest)?.[1]
            : undefined
          if (locale)
            draft.sourceLocale = locale
        },
      },
    ],
  }
}

export default chromeExtension
