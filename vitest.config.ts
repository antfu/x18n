import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (path: string): string => fileURLToPath(new URL(`./packages/${path}`, import.meta.url))

// Tests run against sources; `test/exports.test.ts` checks the built packages.
const alias = [
  {
    find: /^@x18n\/core$/,
    replacement: src('core/src/index.ts'),
  },
  {
    find: /^@x18n\/builtins$/,
    replacement: src('builtins/src/index.ts'),
  },
  {
    find: /^@x18n\/builtins\/([^/]+)$/,
    replacement: src('builtins/src/$1/index.ts'),
  },
  {
    find: /^@x18n\/builtins\/([^/]+\/.+)$/,
    replacement: src('builtins/src/$1'),
  },
  {
    find: /^@x18n\/node$/,
    replacement: src('node/src/index.ts'),
  },
  {
    find: /^@x18n\/lsp$/,
    replacement: src('lsp/src/index.ts'),
  },
  {
    find: /^@x18n\/ui$/,
    replacement: src('ui/src/node/index.ts'),
  },
]

const packages = [
  'builtins',
  'cli',
  'core',
  'devtools',
  'lsp',
  'node',
  'translator-ai',
  'ui',
  'vscode',
]

export default defineConfig({
  test: {
    projects: [
      ...packages.map(name => ({
        // Vite DevTools serves the SPA from next to the built `@x18n/ui`, so devtools tests use built packages.
        resolve: {
          alias: name === 'devtools'
            ? []
            : alias,
        },
        test: { name, root: `./packages/${name}` },
      })),
      {
        test: {
          name: 'exports',
          root: './test',
          include: ['exports.test.ts'],
        },
      },
      // Clones real projects from GitHub; opt-in with `pnpm test:real-world`.
      ...process.env.X18N_REAL_WORLD
        ? [
            {
              test: {
                name: 'real-world',
                root: './test',
                include: ['real-world.test.ts'],
              },
            },
          ]
        : [],
      {
        test: {
          name: 'playgrounds',
          root: './test',
          include: ['playgrounds.test.ts'],
        },
      },
    ],
  },
})
