import type { MessageLeaf, MessageTree } from './types/model'
import type { MessageOp } from './types/plugin'

export function isMessageLeaf(value: unknown): value is MessageLeaf {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** Checks parsed data (for example from `JSON.parse`) before it enters the project. */
export function isMessageTree(value: unknown): value is MessageTree {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  return Object.values(value).every(child => isMessageLeaf(child) || isMessageTree(child))
}

/** Stable id of a stored property path, the key of `ParseResult.ranges`. */
export function pathId(path: readonly string[]): string {
  return path.join('\u0000')
}

export interface TreeLeaf {
  readonly path: readonly string[]
  readonly value: MessageLeaf
}

export function* walkLeaves(tree: MessageTree, prefix: readonly string[] = []): Generator<TreeLeaf> {
  for (const [segment, child] of Object.entries(tree)) {
    const path = [...prefix, segment]
    if (isMessageLeaf(child))
      yield { path, value: child }
    else
      yield* walkLeaves(child, path)
  }
}

export interface MutableTree { [segment: string]: MessageLeaf | MutableTree }

export function cloneTree(tree: MessageTree): MutableTree {
  const out: MutableTree = {}
  for (const [segment, child] of Object.entries(tree)) {
    out[segment] = isMessageLeaf(child)
      ? child
      : cloneTree(child)
  }
  return out
}

function setIn(tree: MutableTree, path: readonly string[], value: MessageLeaf): void {
  let node = tree
  for (const segment of path.slice(0, -1)) {
    const child = node[segment]
    if (child === undefined || isMessageLeaf(child)) {
      const created: MutableTree = {}
      node[segment] = created
      node = created
    }
    else {
      node = child
    }
  }
  node[path.at(-1)!] = value
}

function deleteIn(tree: MutableTree, path: readonly string[]): void {
  const parents: MutableTree[] = [tree]
  let node = tree
  for (const segment of path.slice(0, -1)) {
    const child = node[segment]
    if (child === undefined || isMessageLeaf(child))
      return
    node = child
    parents.push(node)
  }
  delete node[path.at(-1)!]
  // Remove parents left empty.
  for (let i = parents.length - 1; i > 0; i--) {
    if (Object.keys(parents[i]!).length > 0)
      break
    delete parents[i - 1]![path[i - 1]!]
  }
}

/** Applies ops to the tree itself. Parent objects left empty are removed. */
export function applyMessageOpsInPlace(tree: MutableTree, ops: readonly MessageOp[]): void {
  for (const op of ops) {
    if (op.type === 'set')
      setIn(tree, op.path, op.value)
    else
      deleteIn(tree, op.path)
  }
}

/** Applies ops to a copy of the tree. Parent objects left empty are removed. */
export function applyMessageOps(tree: MessageTree, ops: readonly MessageOp[]): MessageTree {
  const out = cloneTree(tree)
  applyMessageOpsInPlace(out, ops)
  return out
}

/** Sorts keys at every level. */
export function sortTree(tree: MessageTree, compare: (a: string, b: string) => number): MessageTree {
  const out: MutableTree = {}
  for (const segment of Object.keys(tree).sort(compare)) {
    const child = tree[segment]!
    out[segment] = isMessageLeaf(child)
      ? child
      : sortTree(child, compare)
  }
  return out
}

/** Builds a nested or flat tree from leaves. */
export function buildTree(leaves: Iterable<TreeLeaf>): MessageTree {
  const out: MutableTree = {}
  for (const leaf of leaves)
    setIn(out, leaf.path, leaf.value)
  return out
}
