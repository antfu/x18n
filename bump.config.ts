import { defineConfig } from 'bumpp'

export default defineConfig({
  // Listing files turns off `--recursive`, so the package manifests are listed too.
  files: [
    'package.json',
    'packages/*/package.json',
    // The Zed registry requires this version to match the release tag.
    'packages/zed/extension.toml',
  ],
})
