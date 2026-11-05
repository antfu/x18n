/**
 * Performance budgets of plans/15-quality.md on a generated fixture:
 * 5,000 source files, 4 locales, 3,000 keys. Writes `bench/results.json` and,
 * when `bench/baseline.json` exists, fails on a regression of more than 20%.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadWorkspace } from '@x18n/node'

const repo = fileURLToPath(new URL('..', import.meta.url))
const bin = join(repo, 'packages/cli/bin.mjs')
const root = join(tmpdir(), 'x18n-bench')
const locales = ['en', 'de', 'fr', 'ja']
const keyCount = 3000
const fileCount = 5000

const budgets = {
  checkCold: 10_000,
  checkWarm: 2_000,
  rescan: 50,
  memory: 300,
} as const

async function generate(): Promise<void> {
  await rm(root, { recursive: true, force: true })
  await mkdir(join(root, 'src/locales'), { recursive: true })
  await mkdir(join(root, '.git'))
  // The fixture has no meaningful call params; keep the benchmark on extraction and analysis, not lint volume.
  await writeFile(join(root, 'x18n.config.json'), `${JSON.stringify({ checks: { 'param-mismatch': 'off' } }, null, 2)}\n`)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    dependencies: { 'vue-i18n': '*' },
  }))
  const keys = Array.from({ length: keyCount }, (_, i) => `section${i % 60}.group${i % 7}.item${i}`)
  for (const [l, locale] of locales.entries()) {
    const tree: Record<string, Record<string, Record<string, string>>> = {}
    keys.forEach((key, i) => {
      if (l > 0 && i % (l + 9) === 0)
        return
      const [a, b, c] = key.split('.') as [string, string, string]
      ;((tree[a] ??= {})[b] ??= {})[c] = `${locale} message ${i} {name}`
    })
    await writeFile(join(root, `src/locales/${locale}.json`), `${JSON.stringify(tree, null, 2)}\n`)
  }
  for (let i = 0; i < fileCount; i++) {
    const dir = join(root, `src/features/f${i % 100}`)
    await mkdir(dir, { recursive: true })
    const used = [0, 1, 2, 3, 4].map(j => keys[(i * 5 + j) % keyCount])
    if (i % 2 === 0) {
      await writeFile(join(dir, `Component${i}.vue`), `<script setup lang="ts">\nconst { t } = useI18n()\nconst label = t('${used[0]}')\n</script>\n\n<template>\n  <div>\n    <h1>{{ $t('${used[1]}') }}</h1>\n    <p :title="$t('${used[2]}')">{{ t('${used[3]}', { name }) }}</p>\n    <span>Some hard string ${i}</span>\n  </div>\n</template>\n`)
    }
    else {
      await writeFile(join(dir, `module${i}.ts`), `import { useI18n } from 'vue-i18n'\n\nexport function use${i}() {\n  const { t } = useI18n()\n  return [${used.map(k => `t('${k}')`).join(', ')}, t(\`section${i % 60}.\${'x'}\`)]\n}\n`)
    }
  }
}

function time(args: string[]): number {
  const start = performance.now()
  try {
    execFileSync(process.execPath, [bin, ...args], { cwd: root, stdio: 'ignore' })
  }
  catch {}
  return performance.now() - start
}

async function measureLsp(): Promise<{ rescan: number, memory: number }> {
  const before = process.memoryUsage().rss
  const { projects } = await loadWorkspace({ cwd: root, cache: false })
  const project = projects[0]!.project
  project.analyze()
  const memory = (process.memoryUsage().rss - before) / 1024 / 1024
  const path = 'src/features/f1/module1.ts'
  const samples: number[] = []
  // The first steps compile the code paths; then many samples, so the median of a ~30 ms step is stable enough for a 20% gate.
  const warmup = 10
  for (let i = 0; i < warmup + 40; i++) {
    await writeFile(join(root, path), `import { useI18n } from 'vue-i18n'\nconst { t } = useI18n()\nt('section1.group1.item${i}')\n`)
    const start = performance.now()
    await project.update([
      { type: 'change', path },
    ])
    project.analyze()
    if (i >= warmup)
      samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return { rescan: samples[Math.floor(samples.length / 2)]!, memory }
}

await generate()
await rm(join(root, 'node_modules/.cache'), { recursive: true, force: true })
const checkCold = time(['check', '--reporter', 'json'])
const checkWarm = time(['check', '--reporter', 'json'])
const { rescan, memory } = await measureLsp()
const results = { checkCold, checkWarm, rescan, memory }

const lines = Object.entries(results).map(([name, value]) => {
  const budget = budgets[name as keyof typeof budgets] // keys of `results` mirror `budgets`
  const unit = name === 'memory'
    ? 'MB'
    : 'ms'
  return `${name.padEnd(10)} ${value.toFixed(1).padStart(9)} ${unit}  (budget ${budget} ${unit})${value > budget
    ? '  OVER BUDGET'
    : ''}`
})
console.log(lines.join('\n'))

await mkdir(join(repo, 'bench'), { recursive: true })
await writeFile(join(repo, 'bench/results.json'), `${JSON.stringify(results, null, 2)}\n`)
let failed = Object.entries(results).some(([name, value]) => value > budgets[name as keyof typeof budgets]) // same keys
const baselineFile = join(repo, 'bench/baseline.json')
if (existsSync(baselineFile)) {
  const baseline: Record<string, number> = JSON.parse(await readFile(baselineFile, 'utf8'))
  for (const [name, value] of Object.entries(results)) {
    const base = baseline[name]
    if (base !== undefined && value > base * 1.2) {
      console.log(`${name} regressed: ${value.toFixed(1)} vs baseline ${base.toFixed(1)} (> 20%)`)
      failed = true
    }
  }
}
process.exitCode = failed ? 1 : 0
