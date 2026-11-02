import type { EditOp, KeyString, Usage } from '../types/model'
import type { KeptUnusedKey, Plan, ResourceNode, UnusedDeletion, UnusedKeyDeletion, UnusedQuery } from '../types/project'
import { keyMatcher, splitKey } from '../keys'

export interface UnusedDeletionOptions {
  /** `analyze().unused`: already leaves out keys that static, prefix and derived usages, `keysInUse` and references reach. */
  readonly unused: readonly KeyString[]
  readonly usages: readonly Usage[]
  readonly namespaced: boolean
  readonly ignoreKeys: readonly string[]
  readonly locations: (key: KeyString) => readonly ResourceNode[]
  readonly plan: (ops: readonly EditOp[]) => Plan
}

/**
 * True when a fully dynamic usage (`t(key)`) may reach `key`: the key lies in the usage's scope namespace and under its
 * scope key prefix. Undefined for a usage without a scope, which may reach any key.
 */
function scopeMatcher(usage: Usage, namespaced: boolean): ((key: KeyString) => boolean) | undefined {
  const namespace = namespaced
    ? usage.scopeNamespace
    : undefined
  const prefix = usage.scopePrefix
  if (namespace === undefined && !prefix)
    return undefined
  return (key) => {
    const id = splitKey(key, namespaced)
    if (namespace !== undefined && id.namespace !== namespace)
      return false
    if (!prefix)
      return true
    const path = id.path.join('.')
    return path === prefix || path.startsWith(`${prefix}.`)
  }
}

export function planUnusedDeletion(options: UnusedDeletionOptions, query: UnusedQuery = {}): UnusedDeletion {
  const ignored = keyMatcher(options.ignoreKeys)
  const match = query.glob
    ? keyMatcher([query.glob])
    : undefined
  const candidates = [...options.unused].filter(key => !ignored(key)
    && (match === undefined || match(key))
    && (query.namespace === undefined || splitKey(key, options.namespaced).namespace === query.namespace)).sort()

  const scoped: { usage: Usage, reaches: (key: KeyString) => boolean }[] = []
  const unscoped: Usage[] = []
  for (const usage of options.usages) {
    if (usage.dynamic !== 'unknown')
      continue
    const reaches = scopeMatcher(usage, options.namespaced)
    if (reaches)
      scoped.push({ usage, reaches })
    else
      unscoped.push(usage)
  }

  const keys: UnusedKeyDeletion[] = []
  const kept: KeptUnusedKey[] = []
  for (const key of candidates) {
    const usages = scoped.filter(s => s.reaches(key)).map(s => s.usage)
    if (usages.length > 0) {
      kept.push({ key, usages })
      continue
    }
    keys.push({
      key,
      messages: options.locations(key).filter(node => node.leaf).map(node => ({ locale: node.locale, path: node.path })),
    })
  }

  const plan = options.plan(keys.map(({ key }) => ({ type: 'delete', key, locales: 'all' })))
  if (unscoped.length === 0 || keys.length === 0)
    return { plan, keys, kept }
  const files = [
    ...new Set(unscoped.map(usage => usage.path)),
  ].sort()
  const shown = files.length > 5
    ? `${files.slice(0, 5).join(', ')} and ${files.length - 5} more files`
    : files.join(', ')
  const warning = `${unscoped.length} usage${unscoped.length === 1
    ? ' has'
    : 's have'} a fully dynamic key (in ${shown}) that may reach any key; list the keys they use in \`usage.keysInUse\` to keep them.`
  return {
    plan: {
      ...plan,
      warnings: [
        ...plan.warnings,
        warning,
      ],
    },
    keys,
    kept,
  }
}
