import type { Diagnostics } from 'nostics'
import { defineDiagnostics, Diagnostic } from 'nostics'

/** A place in a file; `line` is 1-based. */
interface At {
  readonly path: string
  readonly line?: number | undefined
}

function at(p: At): string {
  return p.line === undefined
    ? p.path
    : `${p.path}:${p.line}`
}

/**
 * Every coded error. Groups: 0xxx config, 1xxx plugin, 2xxx discovery and parse,
 * 3xxx scanning, 4xxx edits, 5xxx reviews, 6xxx machine translation. `fix` stays static so the docs can show it.
 */
export const errorDefinitions = {
  X18N0001: {
    why: (p: { issue: string }): string => `Invalid config: ${p.issue}`,
    fix: 'Check the reported field against the config schema (`x18n schema config`).',
  },
  X18N0002: {
    why: (p: { file: string, reason: string }): string => `Config file ${p.file} could not be loaded: ${p.reason}`,
    fix: 'Fix the syntax error, or run `x18n doctor` for details.',
  },
  X18N0003: {
    why: (p: { name: string | undefined, available: readonly string[] }): string =>
      `${p.name === undefined
        ? 'Pick a project'
        : `Unknown project "${p.name}"`} (${p.available.join(', ')})`,
    fix: 'Pick a project name listed by `x18n status`, for example with `--project`.',
  },
  X18N1001: {
    why: (p: { specifier: string, reason: string }): string => `Plugin ${p.specifier} could not be loaded: ${p.reason}`,
    fix: 'Install the plugin package, or check the path.',
  },
  X18N1002: {
    why: (p: { kind: string, id: string }): string => `Duplicate ${p.kind} id "${p.id}"`,
    fix: 'Rename the id, or set `override: true` on the later one.',
  },
  X18N1003: {
    why: (p: { preset: string }): string => `Unknown preset "${p.preset}"`,
    fix: 'Use a preset name listed in the docs, or a preset object.',
  },
  X18N1004: {
    why: (p: { file: string, issues: string }): string => `Invalid YAML plugin ${p.file}: ${p.issues}`,
    fix: 'Validate the file against `schema/plugin.json`.',
  },
  X18N2001: {
    why: (p: { path: string }): string => `No format for resource ${p.path}`,
    fix: 'Map the extension in `formats`, or add a format plugin.',
  },
  X18N2002: {
    why: (p: At & { reason: string }): string => `Resource ${at(p)} could not be parsed: ${p.reason}`,
    fix: 'Fix the syntax error in the file.',
  },
  X18N2003: {
    why: (p: At & { reason?: string | undefined }): string => `Resource ${at(p)} is not an object of messages${p.reason
      ? `: ${p.reason}`
      : ''}`,
    fix: 'Locale files hold nested objects of strings, numbers, booleans or null.',
  },
  X18N2004: {
    why: (p: At & { reason: string }): string => `Locale file ${at(p)} is not static: ${p.reason}`,
    fix: 'Use JSON or YAML, or opt in to execution with `execute: true` on the resource pattern.',
  },
  X18N2005: {
    why: (p: At & { reason: string }): string => `Locale file ${at(p)} could not be executed: ${p.reason}`,
    fix: 'Fix the error the file throws, or make it static and drop `execute: true`.',
  },
  X18N3001: {
    why: (p: { path: string, reason: string }): string => `Source file ${p.path} could not be scanned: ${p.reason}`,
    fix: 'Fix the syntax error, or exclude the file with `usage.exclude`.',
  },
  X18N4001: {
    why: (p: { path: string }): string => `Resource ${p.path} is read-only`,
    fix: 'Edit the source of computed values, or use a writable format.',
  },
  X18N4002: {
    why: (p: { key: string, files: readonly string[] }): string => `Rename target "${p.key}" already exists${p.files.length
      ? ` in ${p.files.join(', ')}`
      : ''}`,
    fix: 'Delete or rename the existing key first.',
  },
  X18N4003: {
    why: (p: { decisions: readonly string[] }): string => `A decision is needed: ${p.decisions.join(' ')}`,
    fix: 'Answer the listed decisions, or pass `--yes` to accept defaults.',
  },
  X18N4004: {
    why: (p: { path?: string | undefined }): string => p.path === undefined
      ? 'Plan is stale'
      : `Plan is stale: ${p.path} changed since the plan was made`,
    fix: 'Files changed since the plan was made. Plan again.',
  },
  X18N4005: {
    why: (p: { key: string, locale: string }): string => `No resource for the key ${p.key} in ${p.locale}`,
    fix: 'Add a resource pattern for the locale, or create the locale file.',
  },
  X18N4006: {
    why: (p: { key: string }): string => `Key not found: "${p.key}"`,
    fix: 'List keys with `x18n keys` (agents: the `x18n_keys` tool).',
  },
  X18N4007: {
    why: (p: { count: number }): string => `Placeholder mismatch in ${p.count} values`,
    fix: 'Keep every placeholder of the source value, or pass `--force`.',
  },
  X18N4008: {
    why: (p: { reason: string }): string => `Invalid edit input: ${p.reason}`,
    fix: 'Check the input shape against the docs.',
  },
  X18N5001: {
    why: (p: { path: string, reason: string }): string => `Review file ${p.path} could not be read: ${p.reason}`,
    fix: 'Fix the file against `schema/reviews.json`, or restore it from git.',
  },
  X18N5003: {
    why: (p: { reason: string }): string => `Reviews are not available: ${p.reason}`,
    fix: 'Set `review.enabled` to true, and fix the review file if the check reports a problem with it.',
  },
  X18N5004: {
    why: (p: { id: string }): string => `Review not found: ${p.id}`,
    fix: 'List review ids with `x18n review list` (agents: the `x18n_reviews` tool).',
  },
  X18N5005: {
    why: (p: { id: string }): string => `Review ${p.id} is not an open suggestion`,
    fix: 'Apply only open reviews of type `suggestion`.',
  },
  X18N5006: {
    why: (): string => 'A batch approval needs a key glob, a namespace, a filter or the values to approve',
    fix: 'Narrow it, for example with `--machine` or a glob; `**` approves every key on purpose.',
  },
  X18N6001: {
    why: (p: { locale: string }): string => `No translator for ${p.locale}`,
    fix: 'Add a translator plugin, such as `@x18n/translator-ai`, and list its id in `translate.translators` if you set that option.',
  },
  X18N6002: {
    why: (p: { id: string, available: readonly string[] }): string => `Unknown translator "${p.id}" (${p.available.length > 0
      ? p.available.join(', ')
      : 'none registered'})`,
    fix: 'Use an id listed by `x18n translators`.',
  },
}

export type ErrorCode = keyof typeof errorDefinitions

export type X18nError = Diagnostic & { readonly name: ErrorCode, readonly code: ErrorCode }

type ErrorHandles = { readonly [C in ErrorCode]: (...args: Parameters<Diagnostics<typeof errorDefinitions, []>[C]>) => X18nError }

/** Raise with `throw errors.X18N2002({ path, reason })`. Core has no reporters: surfaces print what they catch. */
export const errors: ErrorHandles = defineDiagnostics({
  docsBase: 'https://x18n.dev/errors',
  codes: errorDefinitions,
}) as ErrorHandles // nostics types `name` and `code` as string; each handle sets both to its own code

/** JSON form of an error: the `toJSON()` of a nostics diagnostic, without `stack`, `cause` and `data`. */
export interface ErrorInfo {
  /** The code, such as `X18N2002`, or the JS error name of an error without a code. */
  readonly name: string
  readonly why: string
  readonly fix?: string | undefined
  readonly docs?: string | undefined
}

export function isX18nError(error: unknown): error is X18nError {
  return error instanceof Diagnostic && Object.hasOwn(errorDefinitions, error.code)
}

export function toErrorInfo(error: unknown): ErrorInfo {
  if (isX18nError(error)) {
    return {
      name: error.name,
      why: error.why,
      fix: error.fix,
      docs: error.docs,
    }
  }
  return error instanceof Error
    ? { name: error.name, why: error.message }
    : {
        name: 'Error',
        why: String(error),
      }
}
