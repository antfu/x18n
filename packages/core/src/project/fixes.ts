import type { Diagnostic, EditOp, Fix, Usage } from '../types/model'
import type { FixPlan, FixQuery, Plan } from '../types/project'
import { dynamicReach, unscopedWarning } from './unused'

export interface FixPlanOptions {
  readonly usages: readonly Usage[]
  readonly namespaced: boolean
  readonly plan: (ops: readonly EditOp[]) => Plan
}

/** The first fix of a diagnostic that the query allows: `safe`, or also `unsafe` with `unsafe: true`. */
function pick(diagnostic: Diagnostic, unsafe: boolean): Fix | undefined {
  return diagnostic.fixes.find(fix => fix.level === 'safe' || (unsafe && fix.level === 'unsafe'))
}

/** Identifies ops that do the same: a second `set` of a key in a locale is dropped, so the first value wins. */
function opId(op: EditOp): string {
  return op.type === 'set'
    ? JSON.stringify([op.type, op.key, op.locale])
    : JSON.stringify(op)
}

/**
 * Plans the fixes of many diagnostics as one plan. Deletes go first, so a deleted message makes room for a key that a
 * later `set` with `replace: false` adds under it. Identical ops are planned once.
 */
export function planFixes(diagnostics: readonly Diagnostic[], options: FixPlanOptions, query: FixQuery = {}): FixPlan {
  const unsafe = query.unsafe === true
  const fixed: Diagnostic[] = []
  const skipped: Diagnostic[] = []
  const deletes = new Map<string, EditOp>()
  const others = new Map<string, EditOp>()
  for (const diagnostic of diagnostics) {
    const fix = pick(diagnostic, unsafe)
    if (!fix) {
      if (diagnostic.fixes.some(f => f.level === 'unsafe'))
        skipped.push(diagnostic)
      continue
    }
    fixed.push(diagnostic)
    for (const op of fix.ops) {
      const ops = op.type === 'delete'
        ? deletes
        : others
      const id = opId(op)
      if (!ops.has(id))
        ops.set(id, op)
    }
  }
  const plan = options.plan([
    ...deletes.values(),
    ...others.values(),
  ])
  const deletesEverywhere = [
    ...deletes.values(),
  ].some(op => op.type === 'delete' && (op.locales === undefined || op.locales === 'all'))
  const { unscoped } = dynamicReach(options.usages, options.namespaced)
  return {
    plan: deletesEverywhere && unscoped.length > 0
      ? {
          ...plan,
          warnings: [
            ...plan.warnings,
            unscopedWarning(unscoped),
          ],
        }
      : plan,
    fixed,
    skipped,
  }
}
