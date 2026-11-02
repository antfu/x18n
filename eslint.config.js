// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: true,
    // No CSS linter is configured, so style blocks would be parsed as JS.
    vue: {
      sfcBlocks: {
        blocks: { styles: false },
      },
    },
    antislop: true,
    ignores: [
      '**/.nuxt',
      '**/.output',
      '**/.data',
      'packages/vscode/src/generated',
      '**/.vscode-test',
      'packages/core/schema',
      // Rust/WASM package has its own Node and Cargo checks.
      'packages/zed',
      // Sample user projects for tests.
      'test/fixtures',
      'playground',
    ],
  },
  {
    rules: {
      'antfu/reasonable-newline': 'error',
      // Parsers, scanners and the edit planner walk trees; 25 keeps them readable without splitting every visitor.
      'sonarjs/cognitive-complexity': ['error', 25],
    },
  },
  {
    // French typography puts a no-break space before `:`, `?`, `!` and `%`.
    files: ['packages/ui/app/locales/*.json'],
    rules: {
      'no-irregular-whitespace': 'off',
    },
  },
  // Layer rules (plans/01-architecture.md): core runs anywhere and names no library or format;
  // builtins use only the public core API and no Node APIs.
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'vscode',
                'vscode-*',
                'devframe',
                'devframe/*',
                '@x18n/*',
              ],
              message: 'Core runs in any JS runtime and depends on no surface.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/builtins/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'vscode',
                'devframe',
                '@x18n/node',
                '@x18n/cli',
                '@x18n/lsp',
                '@x18n/ui',
                '@x18n/core/*',
              ],
              message: 'Built-ins use only the public API of @x18n/core and no Node APIs.',
            },
          ],
        },
      ],
    },
  },
)
