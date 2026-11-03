import type { DetectContext, Host } from '@x18n/core'

export function dependsOn(names: readonly string[], prefixes: readonly string[] = []): (ctx: DetectContext) => boolean {
  return ctx => ctx.hasAnyDependency(names) || [...ctx.dependencies].some(dep => prefixes.some(prefix => dep.startsWith(prefix)))
}

/** True in a TypeScript project: one with a `tsconfig.json`, or with `typescript` installed. For typegen targets that write a `.d.ts`. */
export async function usesTypeScript(host: Host): Promise<boolean> {
  return await host.readFile('tsconfig.json') !== undefined || await host.readFile('node_modules/typescript/package.json') !== undefined
}

/** Extensions of JS and TS sources. */
export const scriptExtensions: readonly string[] = [
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'mts',
  'cts',
]
