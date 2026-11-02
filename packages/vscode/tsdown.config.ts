import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/server.ts'],
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    shims: false,
    dts: false,
    external: ['vscode'],
    // The extension ships without node_modules, so every dependency is bundled.
    noExternal: [/.*/],
    // The native oxc binding is a `.node` file that cannot be bundled, so the extension parses with
    // the WASM build, which loads `parser.wasm32-wasip1.wasm` from beside the bundle.
    alias: { 'oxc-parser': 'oxc-parser/src-js/wasm.js' },
    // jiti (loads `x18n.config.ts`) lazily requires its Babel build as `../dist/babel.cjs` relative to the bundle.
    copy: [
      { from: 'node_modules/@oxc-parser/binding-wasm32-wasip1/parser.wasm32-wasip1.wasm', to: 'dist' },
      { from: '../node/node_modules/jiti/dist/babel.cjs', to: 'dist' },
      // Bundled `@x18n/ui` serves the Nuxt SPA from `./public` next to its chunk in `dist/`.
      { from: '../ui/dist/public', to: 'dist' },
    ],
    // Prefer ESM entries: UMD `main` builds (jsonc-parser) `require` relative files that are not bundled.
    inputOptions: {
      resolve: {
        mainFields: ['module', 'main'],
      },
    },
  },
  {
    // The e2e suite, loaded with `require` by the VS Code extension host; not packaged.
    entry: { suite: 'test/e2e/suite.ts' },
    outDir: 'test/e2e/dist',
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    dts: false,
    external: ['vscode'],
  },
])
