/** One entry of a context menu. */
export type MenuItem
  = | {
    readonly label: string
    readonly icon?: string | undefined
    /** Shown on the right, for example the shortcut that does the same. */
    readonly hint?: string | undefined
    readonly disabled?: boolean | undefined
    /** Destructive: drawn in the error color. */
    readonly danger?: boolean | undefined
    /** Asks for a second activation, with this label, before running `action`. */
    readonly confirm?: string | undefined
    readonly action: () => unknown
  }
  | { readonly heading: string }
  | { readonly separator: true }

/** Where a context menu opens: the pointer, or the cell a keyboard opened it from. */
export interface MenuPosition {
  readonly x: number
  readonly y: number
}
