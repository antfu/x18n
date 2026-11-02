import type { AgentCheckQuery, AgentDeleteQuery, AgentKeysQuery, AgentRenameQuery, AgentReviewQuery, AgentSearchQuery, AgentSetQuery, AgentUsagesQuery, ApplyQuery, ExtractApplyQuery, ExtractQuery, KeyQuery, OpenQuery, PlanQuery, ProjectQuery, PromptQuery, ReviewQuery, UsageQuery } from './types'
import * as v from 'valibot'

function text(description: string): v.SchemaWithPipe<readonly [v.StringSchema<undefined>, v.DescriptionAction<string, string>]> {
  return v.pipe(v.string(), v.description(description))
}

const project = v.optional(text('Project name from `x18n_status`. Required only in a monorepo with several projects.'))
const leaf = v.union([
  v.string(),
  v.number(),
  v.boolean(),
  v.null(),
])
const textRange = v.object({
  start: v.number(),
  end: v.number(),
})

export const ProjectQuerySchema: v.GenericSchema<ProjectQuery> = v.object({ project })

export const KeyQuerySchema: v.GenericSchema<KeyQuery> = v.object({
  project,
  key: text('Full key, for example `nav.home` or `common:save`.'),
})

export const UsageQuerySchema: v.GenericSchema<UsageQuery> = v.object({
  project,
  key: v.optional(text('Only usages of this key.')),
  path: v.optional(text('Only usages in this file (path relative to the project root).')),
})

export const PromptQuerySchema: v.GenericSchema<PromptQuery> = v.object({
  project,
  locale: text('Target locale code, as listed by `x18n_status`.'),
  keys: v.optional(v.union([
    text('Key glob: `*` inside a segment, `**` across segments.'),
    v.array(v.string()),
  ])),
  namespace: v.optional(v.string()),
  limit: v.optional(v.pipe(v.number(), v.description('Messages per prompt. Default 50.'))),
  cursor: v.optional(text('`nextCursor` of the previous prompt.')),
  stale: v.optional(v.pipe(v.boolean(), v.description('Also translate stale translations: those older than their source message.'))),
  check: v.optional(v.pipe(v.union([
    v.boolean(),
    v.array(v.string()),
  ]), v.description('Also translate values that checks report in the target locale, such as copies of the source (`identical-to-source`): `true` for every check, or a list of check ids.'))),
})

const reviewType = v.picklist([
  'comment',
  'approve',
  'request-change',
  'suggestion',
])

const EditOpSchema = v.variant('type', [
  v.object({
    type: v.literal('set'),
    key: v.string(),
    locale: v.string(),
    value: leaf,
  }),
  v.object({
    type: v.literal('rename'),
    from: v.string(),
    to: v.string(),
    usages: v.exactOptional(v.boolean()),
  }),
  v.object({
    type: v.literal('rename-prefix'),
    from: v.string(),
    to: v.string(),
    usages: v.exactOptional(v.boolean()),
  }),
  v.object({
    type: v.literal('delete'),
    key: v.string(),
    locales: v.exactOptional(v.union([
      v.literal('all'),
      v.array(v.string()),
    ])),
  }),
  // The server fills in the author, id and time.
  v.object({
    type: v.literal('review'),
    key: v.string(),
    locale: v.string(),
    review: reviewType,
    text: v.exactOptional(v.string()),
    suggestion: v.exactOptional(v.string()),
  }),
  v.object({
    type: v.literal('resolve-review'),
    id: v.string(),
  }),
  v.object({
    type: v.literal('apply-suggestion'),
    id: v.string(),
  }),
  v.object({
    type: v.literal('mark-fresh'),
    key: v.string(),
    locales: v.exactOptional(v.array(v.string())),
  }),
])

export const ReviewQuerySchema: v.GenericSchema<ReviewQuery> = v.object({
  project,
  key: v.optional(text('Only reviews of this key.')),
  locale: v.optional(text('Only reviews of this locale.')),
  open: v.optional(v.pipe(v.boolean(), v.description('Only unresolved comments, and only threads that have some.'))),
})

export const PlanQuerySchema: v.GenericSchema<PlanQuery> = v.object({
  project,
  ops: v.array(EditOpSchema),
})

export const ApplyQuerySchema: v.GenericSchema<ApplyQuery> = v.object({
  project,
  ops: v.array(EditOpSchema),
  answers: v.optional(v.record(v.string(), v.string())),
  force: v.optional(v.boolean()),
})

export const ExtractQuerySchema: v.GenericSchema<ExtractQuery> = v.object({
  project,
  files: v.optional(v.pipe(v.array(v.string()), v.description('Only these files (globs relative to the project root). Default: every scanned file.'))),
})

const ExtractItemSchema = v.object({
  path: v.string(),
  range: textRange,
  original: v.string(),
  key: v.string(),
  value: v.string(),
  replacement: v.string(),
  imports: v.array(v.string()),
})

export const ExtractApplySchema: v.GenericSchema<ExtractApplyQuery> = v.object({
  project,
  items: v.pipe(v.array(ExtractItemSchema), v.description('Items from `x18n_extract_plan`, keys and replacements edited as needed; drop items to skip them.')),
})

export const OpenQuerySchema: v.GenericSchema<OpenQuery> = v.object({
  project,
  path: v.string(),
  line: v.number(),
  column: v.number(),
})

/** Agent tools only. */
export const AgentKeysSchema: v.GenericSchema<AgentKeysQuery> = v.object({
  project,
  glob: v.optional(text('Key glob: `*` inside a segment, `**` across segments.')),
  missing: v.optional(text('Only keys missing or empty in this locale.')),
  unused: v.optional(v.pipe(v.boolean(), v.description('Only keys without usages in code.'))),
  namespace: v.optional(v.string()),
  values: v.optional(v.pipe(v.boolean(), v.description('Include the value per locale.'))),
  limit: v.optional(v.pipe(v.number(), v.description('Page size. Default 100.'))),
  cursor: v.optional(text('`nextCursor` of the previous page.')),
})

export const AgentSearchSchema: v.GenericSchema<AgentSearchQuery> = v.object({
  project,
  query: text('Text of the message, as seen in the app, in any locale.'),
  exact: v.optional(v.pipe(v.boolean(), v.description('Only values containing the query. By default a fuzzy match also counts.'))),
  limit: v.optional(v.pipe(v.number(), v.description('Page size. Default 100.'))),
  cursor: v.optional(text('`nextCursor` of the previous page.')),
})

export const AgentUsagesSchema: v.GenericSchema<AgentUsagesQuery> = v.object({
  project,
  key: v.optional(text('Only usages of this key.')),
  path: v.optional(text('Only usages in this file (path relative to the project root).')),
  limit: v.optional(v.pipe(v.number(), v.description('Page size. Default 100.'))),
  cursor: v.optional(text('`nextCursor` of the previous page.')),
})

export const AgentCheckSchema: v.GenericSchema<AgentCheckQuery> = v.object({
  project,
  only: v.optional(v.pipe(v.array(v.string()), v.description('Only these check ids, for example `placeholder-mismatch`, `invalid-syntax`, `missing-translation`.'))),
  locale: v.optional(v.pipe(v.array(v.string()), v.description('Only diagnostics for these locales.'))),
  limit: v.optional(v.pipe(v.number(), v.description('Page size. Default 100.'))),
  cursor: v.optional(text('`nextCursor` of the previous page.')),
})

export const AgentSetSchema: v.GenericSchema<AgentSetQuery> = v.object({
  project,
  messages: v.pipe(v.record(v.string(), v.record(v.string(), leaf)), v.description('`{ "<locale>": { "<key>": "<value>" } }`, the same shape as `x18n apply`.')),
  force: v.optional(v.pipe(v.boolean(), v.description('Write values even when their placeholders differ from the source value.'))),
})

const confirm = v.optional(v.pipe(v.boolean(), v.description('Apply the plan. Without it, the tool only returns the plan.')))
const answers = v.optional(v.pipe(v.record(v.string(), v.string()), v.description('Decision id to option id, for decisions in the plan. Default: each decision\'s `default`.')))

export const AgentRenameSchema: v.GenericSchema<AgentRenameQuery> = v.object({
  project,
  from: text('Key (or parent of keys) to rename.'),
  to: text('New key.'),
  usages: v.optional(v.pipe(v.boolean(), v.description('Also rewrite usages in code. Default true.'))),
  confirm,
  answers,
})

export const AgentReviewSchema: v.GenericSchema<AgentReviewQuery> = v.object({
  project,
  key: text('Key of the reviewed message.'),
  locale: text('Locale of the reviewed message.'),
  review: v.pipe(reviewType, v.description('`request-change` for a wrong translation (say why in `text`), `suggestion` to propose a value (in `suggestion`), `approve` for a good one, `comment` for anything else.')),
  text: v.optional(text('The comment: what is wrong, or why.')),
  suggestion: v.optional(text('The proposed value, for `review: "suggestion"`. Keep every placeholder.')),
})

export const AgentDeleteSchema: v.GenericSchema<AgentDeleteQuery> = v.object({
  project,
  key: text('Key (or parent of keys) to delete.'),
  locales: v.optional(v.pipe(v.array(v.string()), v.description('Only in these locales. Default: all.'))),
  confirm,
  answers,
})
