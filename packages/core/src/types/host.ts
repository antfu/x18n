import type { ReviewAuthor } from './review'

export interface Disposable {
  readonly dispose: () => void
}

export interface GlobOptions {
  readonly ignore?: readonly string[] | undefined
  /** Honour the project's `.gitignore` files. */
  readonly gitignore?: boolean | undefined
}

export interface FileEvent {
  readonly type: 'create' | 'change' | 'delete'
  /** Posix path relative to the host root. */
  readonly path: string
}

/** Persistent key-value store. Values are JSON text. */
export interface CacheStore {
  readonly get: (key: string) => Promise<string | undefined>
  readonly set: (key: string, value: string) => Promise<void>
}

export interface Logger {
  readonly info: (message: string) => void
  readonly warn: (message: string) => void
  readonly error: (message: string) => void
}

/** Gives a project file access, globbing, watching and caching. All paths are posix and relative to `root`. */
export interface Host {
  readonly root: string
  readonly readFile: (path: string) => Promise<string | undefined>
  readonly writeFile: (path: string, content: string) => Promise<void>
  readonly deleteFile: (path: string) => Promise<void>
  readonly glob: (patterns: readonly string[], options?: GlobOptions) => Promise<string[]>
  readonly watch?: ((patterns: readonly string[], onChange: (events: readonly FileEvent[]) => void) => Disposable) | undefined
  readonly cache?: CacheStore | undefined
  readonly logger?: Logger | undefined
  /** Who writes reviews. The node host reads git `user.name` and `user.email`. */
  readonly identity?: (() => Promise<ReviewAuthor | undefined>) | undefined
  /**
   * Runs a JS or TS module and returns its default export (or its namespace without one), for resources with
   * `execute: true`. Hosts that cannot run code leave it out; their executed resources are read statically.
   */
  readonly executeModule?: ((path: string) => Promise<unknown>) | undefined
  /** An environment variable, for secrets that config refers to (`{ env: 'DEEPL_API_KEY' }`). The node host reads `process.env`. */
  readonly env?: ((name: string) => string | undefined) | undefined
}
