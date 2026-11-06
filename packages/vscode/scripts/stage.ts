import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'

// Turborepo needs unique workspace names and the CLI owns `x18n`, so the
// extension is packaged from a staged copy named `x18n` (id `antfu.x18n`).
const root = new URL('../', import.meta.url)
const out = new URL('.vsce/', root)

const manifest: { name: string } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const staged = {
  ...manifest,
  name: 'x18n',
  scripts: undefined,
  devDependencies: undefined,
}

await rm(out, { recursive: true, force: true })
await mkdir(out)
await writeFile(new URL('package.json', out), `${JSON.stringify(staged, null, 2)}\n`)
// `package.nls*.json` holds the `package.json` strings per display language, `l10n/` the runtime ones.
const nls = (await readdir(root)).filter(file => /^package\.nls(?:\.[\w-]+)?\.json$/.test(file))
for (const file of [
  'README.md',
  'LICENSE.md',
  'dist',
  'l10n',
  'res',
  ...nls,
])
  await cp(new URL(file, root), new URL(file, out), { recursive: true })
