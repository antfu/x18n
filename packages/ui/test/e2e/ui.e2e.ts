import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildReport, fixture, project, serveStatic, startUi } from './workspace'

test('edits a value in the grid and writes the locale file', async ({ page }) => {
  const { root, dispose } = await fixture()
  const { info, child } = await startUi(root)
  try {
    await page.goto(info.link!)
    await page.getByRole('link', { name: 'Keys', exact: true }).click()
    const cell = page.locator('[data-key="nav.about"] [data-locale="de"]')
    await cell.dblclick()
    await page.getByLabel('Value of nav.about in de').fill('Über uns')
    await page.keyboard.press('Enter')
    await expect.poll(async () => JSON.parse(await readFile(join(root, 'src/locales/de.json'), 'utf8')).nav.about).toBe('Über uns')
    await expect(cell).toContainText('Über uns')
  }
  finally {
    child.kill()
    await dispose()
  }
})

test('edits a value on the key page with save and cancel', async ({ page }) => {
  const { root, dispose } = await fixture()
  const { info, child } = await startUi(root)
  try {
    await page.goto(info.link!)
    await page.getByRole('link', { name: 'Keys', exact: true }).click()
    await page.locator('[data-key="nav.about"] [role="gridcell"]').first().dblclick()
    const value = page.locator('[data-locale="de"]').getByTitle('Edit', { exact: true })
    const editor = page.getByRole('group', { name: 'Value of nav.about in de' })

    await value.dblclick()
    await editor.getByRole('textbox').fill('Verworfen')
    await editor.getByRole('button', { name: 'Cancel' }).click()
    await expect(editor).toHaveCount(0)
    await expect(value).not.toContainText('Verworfen')

    await value.dblclick()
    await editor.getByRole('textbox').fill('Über uns')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect.poll(async () => JSON.parse(await readFile(join(root, 'src/locales/de.json'), 'utf8')).nav.about).toBe('Über uns')
    await expect(editor).toHaveCount(0)
    await expect(value).toContainText('Über uns')
  }
  finally {
    child.kill()
    await dispose()
  }
})

test('refuses unauthenticated clients', async ({ page, request }) => {
  const { root, dispose } = await fixture()
  const { info, child } = await startUi(root)
  try {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }
    const headers = { 'origin': new URL(info.url).origin, 'accept': 'application/json, text/event-stream', 'content-type': 'application/json' }
    expect((await request.post(info.mcp.url, { headers, data: body })).status()).toBe(401)
    expect((await request.post(info.mcp.url, {
      headers: { ...headers, authorization: 'Bearer nope' },
      data: body,
    })).status()).toBe(401)

    await page.goto(info.url)
    await expect(page.getByRole('heading', { name: 'Connect to x18n' })).toBeVisible()
    await page.getByLabel('Auth code').fill('000000')
    await page.getByRole('button', { name: 'Connect' }).click()
    await expect(page.getByText('That code did not work')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Keys', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Keys', exact: true }).click()
    await expect(page.locator('[data-key]')).toHaveCount(0)
  }
  finally {
    child.kill()
    await dispose()
  }
})

test('the locale bar hides a locale in every view and remembers it', async ({ page }) => {
  const { root, dispose } = await fixture()
  const outDir = join(root, '.x18n/report')
  await buildReport(root, outDir)
  const server = await serveStatic(outDir)
  try {
    await page.goto(`${server.url}#/keys`)
    const de = page.locator('[data-key="nav.home"] [data-locale="de"]')
    await expect(de).toContainText('Start')
    await page.locator('[data-locale-toggle="de"]').click()
    await expect(page.locator('[data-locale-toggle="de"]')).toHaveAttribute('aria-pressed', 'false')
    await expect(de).toHaveCount(0)
    await expect(page.locator('[data-key="nav.home"] [data-locale="en"]')).toContainText('Home')

    await page.goto(`${server.url}#/keys/nav.home`)
    await page.reload()
    await expect(page.locator('[data-locale="en"]')).toContainText('Home')
    await expect(page.locator('[data-locale="de"]')).toHaveCount(0)

    await page.getByRole('button', { name: 'Show all', exact: true }).click()
    await expect(page.locator('[data-locale="de"]')).toContainText('Start')
  }
  finally {
    server.close()
    await dispose()
  }
})

test('locales reorder by dragging and flags can be turned off', async ({ page }) => {
  const { root, dispose } = await fixture()
  const outDir = join(root, '.x18n/report')
  await buildReport(root, outDir)
  const server = await serveStatic(outDir)
  try {
    await page.goto(`${server.url}#/keys`)
    const headers = page.getByRole('columnheader')
    await expect(headers).toHaveText(['Key', /^en/, /^de/])
    await page.locator('[data-locale-toggle="de"]').dragTo(page.locator('[data-locale-toggle="en"]'), {
      targetPosition: { x: 2, y: 2 },
    })
    await expect(headers).toHaveText(['Key', /^de/, /^en/])
    await page.reload()
    await expect(headers).toHaveText(['Key', /^de/, /^en/])

    await expect(page.locator('[role="columnheader"] [data-flag]')).toHaveCount(2)
    await page.getByTitle('Show flags').click()
    await expect(page.locator('[data-flag]')).toHaveCount(0)
  }
  finally {
    server.close()
    await dispose()
  }
})

test('the UI speaks the requested language and remembers a picked one', async ({ page }) => {
  const { root, dispose } = await fixture()
  const outDir = join(root, '.x18n/report')
  await buildReport(root, outDir)
  const server = await serveStatic(outDir)
  try {
    // The VS Code panel passes `vscode.env.language`, which writes regions in lower case.
    await page.goto(`${server.url}?lang=zh-tw`)
    await expect(page.getByRole('link', { name: '鍵', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant')

    await page.goto(server.url)
    await page.getByRole('button', { name: 'Language' }).click()
    await page.getByRole('menuitemradio', { name: 'Deutsch' }).click()
    await expect(page.getByRole('link', { name: 'Schlüssel', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('link', { name: 'Schlüssel', exact: true })).toBeVisible()
  }
  finally {
    server.close()
    await dispose()
  }
})

test('the static report renders keys without edit controls', async ({ page }) => {
  const { root, dispose } = await fixture()
  const outDir = join(root, '.x18n/report')
  await buildReport(root, outDir)
  const server = await serveStatic(outDir)
  try {
    await page.goto(server.url)
    await expect(page.getByText('Read-only report')).toBeVisible()
    await page.getByRole('link', { name: 'Keys', exact: true }).click()
    await expect(page.locator('[data-key="nav.home"] [data-locale="de"]')).toContainText('Start')
    await page.locator('[data-key="nav.about"] [data-locale="de"]').dblclick()
    await expect(page.getByLabel('Value of nav.about in de')).toHaveCount(0)
    await page.locator('[data-key="app.greeting"] [role="gridcell"]').first().dblclick()
    await expect(page.getByRole('heading', { name: 'app.greeting' })).toBeVisible()
    await expect(page.locator('[data-placeholder]', { hasText: '{name}' })).toBeVisible()
    await expect(page.getByTitle('Edit', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Copy translate prompt' })).toHaveCount(0)
  }
  finally {
    server.close()
    await dispose()
  }
})

test('a wide key page lists every key in a sidebar, as a tree or a list', async ({ page }) => {
  const { root, dispose } = await fixture()
  const outDir = join(root, '.x18n/report')
  await buildReport(root, outDir)
  const server = await serveStatic(outDir)
  try {
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto(`${server.url}#/keys/nav.home`)
    const sidebar = page.locator('aside')
    // The open key's folder is open, so its key shows.
    await expect(sidebar.getByRole('link', { name: 'home', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(sidebar.getByRole('link', { name: 'about', exact: true })).toBeVisible()

    await sidebar.getByRole('button', { name: 'List view' }).click()
    await expect(sidebar.getByRole('link', { name: 'nav.about', exact: true })).toBeVisible()
    await sidebar.getByRole('link', { name: 'nav.about', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'nav.about' })).toBeVisible()

    await page.setViewportSize({ width: 900, height: 900 })
    await expect(sidebar).toBeHidden()
  }
  finally {
    server.close()
    await dispose()
  }
})

test('shows the translation states and notes that formats report', async ({ page }) => {
  const unit = (id: string, source: string, target?: string, state?: string): string => `      <trans-unit id="${id}">
        <source>${source}</source>${target === undefined
          ? ''
          : `\n        <target${state
            ? ` state="${state}"`
            : ''}>${target}</target>`}
        <note from="description">${id} button</note>
      </trans-unit>`
  const xliff = (lang: string, units: string[]): string => `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" ${lang === 'en'
    ? ''
    : `target-language="${lang}" `}datatype="plaintext" original="app">
    <body>
${units.join('\n')}
    </body>
  </file>
</xliff>
`
  const { root, dispose } = await project({
    'x18n.config.json': JSON.stringify({
      resources: [
        { pattern: 'locale/messages.{locale}.xlf' },
      ],
    }),
    'locale/messages.en.xlf': xliff('en', [
      unit('save', 'Save'),
      unit('open', 'Open'),
    ]),
    'locale/messages.de.xlf': xliff('de', [
      unit('save', 'Save', 'Speichern', 'needs-review-translation'),
      unit('open', 'Open', 'Öffnen', 'final'),
    ]),
  })
  const outDir = join(root, '.x18n/report')
  await buildReport(root, outDir)
  const server = await serveStatic(outDir)
  try {
    await page.goto(`${server.url}#/keys`)
    await expect(page.locator('[data-key="save"] [data-locale="de"]').getByTitle('Needs review')).toBeVisible()
    await page.getByLabel('Translation state').selectOption('reviewed')
    await expect(page.locator('[data-key]')).toHaveCount(1)
    await expect(page.locator('[data-key="open"]')).toBeVisible()

    await page.goto(`${server.url}#/keys/save`)
    const de = page.locator('[data-locale="de"]')
    await expect(de.getByText('Needs review')).toBeVisible()
    await expect(de.getByText('save button')).toBeVisible()
  }
  finally {
    server.close()
    await dispose()
  }
})
