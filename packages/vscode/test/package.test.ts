import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const dist = fileURLToPath(new URL('../dist', import.meta.url))

/** The bundled LSP UI server reads devframe client assets from `dist/public`. */
it('ships the built UI SPA beside the server bundle', async () => {
  await expect(access(join(dist, 'public', 'index.html'))).resolves.toBeUndefined()
})
