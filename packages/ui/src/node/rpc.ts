import type { DevframeNodeContext } from 'devframe'
import type { ApplyQuery, DiagnosticQuery, ExtractApplyQuery, ExtractQuery, ExtractSelectionQuery, KeyQuery, OpenQuery, PlanQuery, ProjectList, ProjectQuery, PromptQuery, ReviewQuery, UiLocation, UiProject, UnusedDeletionQuery, UsageQuery } from './types'
import { extractItems, findCandidates, findSelections, renderSelections } from '@x18n/builtins/extractors'
import { renderPrompt } from '@x18n/core'
import { defineRpcFunction } from 'devframe'
import * as v from 'valibot'
import { ApplyQuerySchema, DiagnosticQuerySchema, ExtractApplySchema, ExtractQuerySchema, ExtractSelectionSchema, KeyQuerySchema, OpenQuerySchema, PlanQuerySchema, ProjectQuerySchema, PromptQuerySchema, ReviewQuerySchema, UnusedDeletionSchema, UsageQuerySchema } from './schemas'
import { analysisView, applyOps, diagnosticPage, diagnosticQueries, explainView, keyDetail, keyTable, pickProject, previewOps, summarize, unusedDeletionView, usageViews } from './views'

export interface RpcOptions {
  readonly openInEditor?: ((location: UiLocation) => Promise<void>) | undefined
}

/** Registers the `x18n:*` functions the SPA calls. Queries dump one record per project (and per key) for the static build. */
export function registerRpc(ctx: DevframeNodeContext, projects: readonly UiProject[], options: RpcOptions): void {
  const rpc = ctx.scope('x18n').rpc
  const perProject = (): [ProjectQuery][] => projects.map(p => [
    { project: p.name },
  ])

  rpc.register(defineRpcFunction({
    name: 'project',
    type: 'static',
    jsonSerializable: true,
    handler: (): ProjectList => ({
      projects: projects.map(summarize),
      openInEditor: options.openInEditor !== undefined,
    }),
  }))
  rpc.register(defineRpcFunction({
    name: 'keys',
    type: 'query',
    jsonSerializable: true,
    handler: (query: ProjectQuery) => keyTable(pickProject(projects, v.parse(ProjectQuerySchema, query).project)),
    dump: () => ({
      inputs: perProject(),
    }),
  }))
  rpc.register(defineRpcFunction({
    name: 'key',
    type: 'query',
    jsonSerializable: true,
    handler: (query: KeyQuery) => {
      const { project, key } = v.parse(KeyQuerySchema, query)
      return keyDetail(pickProject(projects, project), key)
    },
    dump: () => ({
      inputs: projects.flatMap(p => p.project.keys().map((key): [KeyQuery] => [
        { project: p.name, key },
      ])),
      fallback: null,
    }),
  }))
  rpc.register(defineRpcFunction({
    name: 'usages',
    type: 'query',
    jsonSerializable: true,
    handler: (query: UsageQuery) => {
      const { project, key, path } = v.parse(UsageQuerySchema, query)
      const p = pickProject(projects, project)
      return usageViews(p, p.project.usages({ key, path }))
    },
    dump: () => ({
      inputs: perProject(),
    }),
  }))
  rpc.register(defineRpcFunction({
    name: 'analysis',
    type: 'query',
    jsonSerializable: true,
    handler: (query: ProjectQuery) => analysisView(pickProject(projects, v.parse(ProjectQuerySchema, query).project)),
    dump: () => ({
      inputs: perProject(),
    }),
  }))
  rpc.register(defineRpcFunction({
    name: 'diagnostics',
    type: 'query',
    jsonSerializable: true,
    handler: (query: DiagnosticQuery) => {
      const { project, ...filter } = v.parse(DiagnosticQuerySchema, query)
      return diagnosticPage(pickProject(projects, project), filter)
    },
    dump: () => ({
      inputs: projects.flatMap(p => diagnosticQueries(p).map((query): [DiagnosticQuery] => [query])),
    }),
  }))
  rpc.register(defineRpcFunction({
    name: 'reviews',
    type: 'query',
    jsonSerializable: true,
    handler: (query: ReviewQuery) => {
      const { project, ...filter } = v.parse(ReviewQuerySchema, query)
      return [
        ...pickProject(projects, project).project.reviews(filter),
      ]
    },
    dump: () => ({
      inputs: perProject(),
    }),
  }))
  rpc.register(defineRpcFunction({
    name: 'explain',
    type: 'static',
    jsonSerializable: true,
    handler: () => ({
      projects: projects.map(explainView),
    }),
  }))
  rpc.register(defineRpcFunction({
    name: 'translate-prompt',
    type: 'query',
    jsonSerializable: true,
    handler: (query: PromptQuery) => {
      const { project, locale, ...options } = v.parse(PromptQuerySchema, query)
      return renderPrompt(pickProject(projects, project).project.prompt('translate', locale, options))
    },
  }))
  rpc.register(defineRpcFunction({
    name: 'extract-candidates',
    type: 'query',
    jsonSerializable: true,
    handler: (query: ExtractQuery) => {
      const { project, files } = v.parse(ExtractQuerySchema, query)
      return findCandidates(pickProject(projects, project).project, { files })
    },
    dump: () => ({
      inputs: perProject(),
    }),
  }))

  rpc.register(defineRpcFunction({
    name: 'extract-selections',
    type: 'query',
    jsonSerializable: true,
    handler: (query: ExtractQuery) => {
      const { project, files } = v.parse(ExtractQuerySchema, query)
      return findSelections(pickProject(projects, project).project, { files })
    },
    dump: () => ({
      inputs: perProject(),
    }),
  }))

  if (ctx.mode !== 'dev')
    return

  rpc.register(defineRpcFunction({
    name: 'plan',
    type: 'action',
    jsonSerializable: true,
    handler: (query: PlanQuery) => {
      const { project, ops } = v.parse(PlanQuerySchema, query)
      return previewOps(pickProject(projects, project), ops)
    },
  }))
  rpc.register(defineRpcFunction({
    name: 'apply',
    type: 'action',
    jsonSerializable: true,
    handler: (query: ApplyQuery) => {
      const { project, ops, answers, force } = v.parse(ApplyQuerySchema, query)
      return applyOps(pickProject(projects, project), ops, { answers, force })
    },
  }))
  rpc.register(defineRpcFunction({
    name: 'delete-unused',
    type: 'action',
    jsonSerializable: true,
    handler: (query: UnusedDeletionQuery) => {
      const parsed = v.parse(UnusedDeletionSchema, query)
      return unusedDeletionView(pickProject(projects, parsed.project), parsed)
    },
  }))
  rpc.register(defineRpcFunction({
    name: 'extract-apply',
    type: 'action',
    jsonSerializable: true,
    handler: (query: ExtractApplyQuery) => {
      const { project, items } = v.parse(ExtractApplySchema, query)
      const p = pickProject(projects, project)
      return applyOps(p, [
        {
          type: 'extract',
          items: extractItems(p.project, items),
        },
      ])
    },
  }))
  rpc.register(defineRpcFunction({
    name: 'extract-selected',
    type: 'action',
    jsonSerializable: true,
    handler: (query: ExtractSelectionQuery) => {
      const { project, items } = v.parse(ExtractSelectionSchema, query)
      const p = pickProject(projects, project)
      return applyOps(p, [
        {
          type: 'extract',
          items: renderSelections(p.project, items),
        },
      ])
    },
  }))
  const open = options.openInEditor
  if (open) {
    rpc.register(defineRpcFunction({
      name: 'open-in-editor',
      type: 'action',
      jsonSerializable: true,
      handler: (query: OpenQuery) => {
        const { project, ...location } = v.parse(OpenQuerySchema, query)
        return open({
          project: pickProject(projects, project),
          ...location,
        })
      },
    }))
  }
}
