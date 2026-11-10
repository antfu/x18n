import type { EditOp } from '@x18n/core'
import type { AgentToolInput, DevframeNodeContext } from 'devframe'
import type { ApplyView, UiProject } from './types'
import { toJsonSchema } from '@valibot/to-json-schema'
import { extractItems, findCandidates, toPlanFile } from '@x18n/builtins/extractors'
import { errors, parseMessageBatch, renderPrompt, toWireDiagnostic } from '@x18n/core'
import * as v from 'valibot'
import { AgentCheckSchema, AgentDeleteSchema, AgentKeysSchema, AgentRenameSchema, AgentReviewSchema, AgentSearchSchema, AgentSetSchema, AgentUsagesSchema, ExtractApplySchema, ExtractQuerySchema, KeyQuerySchema, ProjectQuerySchema, PromptQuerySchema, ReviewQuerySchema, UnusedDeletionSchema } from './schemas'
import { applyOps, keyDetail, pickProject, previewOps, summarize, unusedDeletionView, usageViews } from './views'

function page<T>(items: readonly T[], query: { readonly limit?: number | undefined, readonly cursor?: string | undefined }): { total: number, nextCursor: string | undefined, items: T[] } {
  const start = Number(query.cursor ?? 0) || 0
  const end = start + (query.limit ?? 100)
  return {
    total: items.length,
    nextCursor: end < items.length
      ? String(end)
      : undefined,
    items: items.slice(start, end),
  }
}

/**
 * Registers the MCP tools (`x18n_*` on the wire). Descriptions are written for agents.
 * Tools take one flat object, validated here, so agents see named fields instead of positional args.
 */
export function registerAgentTools(ctx: DevframeNodeContext, projects: readonly UiProject[]): void {
  function tool<T, R>(id: string, safety: NonNullable<AgentToolInput['safety']>, description: string, schema: v.GenericSchema<T>, run: (input: T) => R): void {
    ctx.agent.registerTool({
      id: `x18n:${id}`,
      safety,
      description,
      inputSchema: toJsonSchema(schema),
      handler: (input: unknown) => run(v.parse(schema, input ?? {})),
    })
  }
  const pick = (name: string | undefined): UiProject => pickProject(projects, name)
  /** Plans the ops, and applies them only with `confirm`. */
  const confirmable = (p: UiProject, ops: readonly EditOp[], query: { readonly confirm?: boolean | undefined, readonly answers?: Readonly<Record<string, string>> | undefined }): ApplyView | Promise<ApplyView> =>
    query.confirm
      ? applyOps(p, ops, { answers: query.answers })
      : {
          ...previewOps(p, ops),
          applied: false,
          revision: p.project.revision,
        }

  tool('status', 'read', 'Overview of the i18n project: locales with translation coverage, counts of keys, resources and usages, diagnostics by check, and detected presets. Call it first to learn project names, the source locale and locale codes.', ProjectQuerySchema, query => ({
    projects: (query.project === undefined
      ? projects
      : [
          pick(query.project),
        ]).map(summarize),
  }))

  tool('keys', 'read', 'List message keys, paged. Filter by `missing` locale (keys to translate), `unused` (keys no code uses), `namespace` or a key `glob`. Pass `values: true` to get the value per locale. A key whose format gives it a display label has `label`. Continue with `cursor: nextCursor`.', AgentKeysSchema, (query) => {
    const { project } = pick(query.project)
    const keys = project.keys({
      glob: query.glob,
      missing: query.missing,
      unused: query.unused,
      namespace: query.namespace,
    })
    const { items, ...rest } = page(keys, query)
    return {
      ...rest,
      keys: items.map((key) => {
        const label = project.locales.map(locale => project.message(key, locale)?.label).find(l => l !== undefined)
        return {
          key,
          ...label !== undefined && { label },
          ...query.values && {
            values: Object.fromEntries((project.get(key)?.messages ?? []).map(m => [m.locale, m.value])),
          },
        }
      }),
    }
  })

  tool('get', 'read', 'One key: its value in every locale with file and line (and its translation `state` and `description` when the file records them), locales where it is missing, usages in code with a few lines of context, and diagnostics. Check a key with it before creating or renaming one.', KeyQuerySchema, (query) => {
    const detail = keyDetail(pick(query.project), query.key)
    if (!detail)
      throw errors.X18N4006({ key: query.key })
    return detail
  })

  tool('search', 'read', 'Find keys by their value, best match first: the key behind a text seen in the app. Searches every locale, ignoring case, and matches fuzzily unless `exact`. Each match has the matched locale and value, and the usages in code with file, line and column.', AgentSearchSchema, (query) => {
    const p = pick(query.project)
    const { items, ...rest } = page(p.project.search(query.query, { exact: query.exact }), query)
    return {
      ...rest,
      matches: items.map(m => ({
        key: m.key,
        locale: m.locale,
        value: m.value,
        usages: usageViews(p, p.project.usages({ key: m.key })).map(u => ({
          path: u.path,
          line: u.line,
          column: u.column,
          possible: u.possible,
        })),
      })),
    }
  })

  tool('usages', 'read', 'Usages in code, paged: of one `key` (usages with a computed key under a prefix of it are marked `possible`), of one file (`path`), or all. Each usage has file, line, column and a code snippet.', AgentUsagesSchema, (query) => {
    const p = pick(query.project)
    const { items, ...rest } = page(p.project.usages({ key: query.key, path: query.path }), query)
    return {
      ...rest,
      usages: usageViews(p, items),
    }
  })

  tool('check', 'read', 'Run the checks (missing translations, placeholder mismatches, invalid syntax, unused and undefined keys, ...) and return diagnostics, paged. After writing messages, call it with `only: ["placeholder-mismatch", "invalid-syntax"]` and fix what it reports.', AgentCheckSchema, (query) => {
    const p = pick(query.project)
    const diagnostics = p.project.analyze().diagnostics.filter(d =>
      (!query.only || query.only.includes(d.code)) && (!query.locale || (d.locale !== undefined && query.locale.includes(d.locale))))
    const { items, ...rest } = page(diagnostics, query)
    return {
      ...rest,
      summary: { errors: diagnostics.filter(d => d.severity === 'error').length, warnings: diagnostics.filter(d => d.severity === 'warning').length },
      diagnostics: items.map(d => toWireDiagnostic(p.name, d, path => p.project.text(path))),
    }
  })

  tool('translate_prompt', 'read', 'Instructions for translating missing messages into a locale: rules, glossary, style examples and the items with usage context, as markdown. Follow it, then write the results with x18n_set_messages. It says how many items remain and the cursor for the next batch.', PromptQuerySchema, (query) => {
    const { project, locale, ...options } = query
    return renderPrompt(pick(project).project.prompt('translate', locale, options))
  })

  tool('set_messages', 'action', 'Set many messages at once: `messages` is `{ "<locale>": { "<key>": "<value>" } }`, the same shape as `x18n apply`. Files keep their format, key style and order. When a value drops or adds placeholders compared to the source value, nothing is written and `problems` lists them (`applied: false`); fix the values, or pass `force: true`.', AgentSetSchema, (query) => {
    const p = pick(query.project)
    return applyOps(p, parseMessageBatch(p.project, query.messages), { force: query.force })
  })

  tool('reviews', 'read', 'Review threads: comments, approvals, change requests and suggested values on messages, per key and locale, with each thread\'s state. Pass `open: true` for unresolved ones only.', ReviewQuerySchema, (query) => {
    const { project, ...filter } = query
    return {
      threads: pick(project).project.reviews(filter),
    }
  })

  tool('review', 'action', 'Leave a review on one message for a human: `request-change` with the reason in `text`, or `suggestion` with a better value in `suggestion` (a human applies it), `approve`, or `comment`. Use it when a human should decide, instead of changing values yourself.', AgentReviewSchema, (query) => {
    const p = pick(query.project)
    return applyOps(p, [
      {
        type: 'review',
        key: p.project.parseKey(query.key),
        locale: query.locale,
        review: query.review,
        text: query.text,
        suggestion: query.suggestion,
      },
    ])
  })

  tool('rename_key', 'destructive', 'Rename a key (or every key under a parent) in all locales, and its usages in code unless `usages: false`. Without `confirm` it returns the plan (files to change, decisions, warnings); call again with `confirm: true` to apply it.', AgentRenameSchema, (query) => {
    const p = pick(query.project)
    return confirmable(p, [
      {
        type: 'rename',
        from: p.project.parseKey(query.from),
        to: p.project.parseKey(query.to),
        usages: query.usages !== false,
      },
    ], query)
  })

  tool('delete_key', 'destructive', 'Delete a key (or every key under a parent) in all locales, or only in `locales`. Code is not changed. Without `confirm` it returns the plan; call again with `confirm: true` to apply it.', AgentDeleteSchema, (query) => {
    const p = pick(query.project)
    return confirmable(p, [
      {
        type: 'delete',
        key: p.project.parseKey(query.key),
        locales: query.locales ?? 'all',
      },
    ], query)
  })

  tool('delete_unused_keys', 'destructive', 'Delete every unused key (the keys `x18n_keys` lists with `unused: true`) in all locales, optionally only those matching `glob` or `namespace`. Keys that a computed key in code may reach (a template literal prefix, or a computed key under a `keyPrefix` or namespace) are left alone and listed in `kept`; `warnings` names computed keys that may reach any key. Code is not changed. Without `confirm` it returns the plan: `deleted` lists each key with its locales and files. Call again with `confirm: true` to apply it.', UnusedDeletionSchema, query => unusedDeletionView(pick(query.project), query))

  tool('extract_plan', 'read', 'Find hard-coded strings in source files and propose a key, a message and a code replacement for each. The key names the resource message. The replacement is the code to insert. If you change the key, also update the corresponding message reference in replacement. Preserve other code and the escaping and namespace syntax that the template requires. x18n_extract_apply does not regenerate replacement from the key. Drop items you do not want, then pass the rest to x18n_extract_apply.', ExtractQuerySchema, (query) => {
    const { project } = pick(query.project)
    return toPlanFile(project, findCandidates(project, { files: query.files }))
  })

  tool('extract_apply', 'action', 'Apply extraction items from x18n_extract_plan: adds the messages to the source locale and rewrites the code. Fails when a file changed since the plan was made; plan again then.', ExtractApplySchema, (query) => {
    const p = pick(query.project)
    return applyOps(p, [
      {
        type: 'extract',
        items: extractItems(p.project, query.items),
      },
    ])
  })
}
