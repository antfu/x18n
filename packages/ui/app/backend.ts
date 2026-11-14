import type { ExtractSelection } from '@x18n/builtins/extractors'
import type { ReviewThread } from '@x18n/core'
import type { DevframeRpcClient } from 'devframe/client'
import type { AnalysisView, ApplyQuery, ApplyView, DiagnosticPage, DiagnosticQuery, ExplainList, ExtractApplyQuery, ExtractSelectionQuery, KeyDetail, KeyTable, OpenQuery, PlanQuery, PlanView, ProjectList, UnusedDeletionQuery, UnusedDeletionView, UsageView, X18nState } from '../src/node/types'
import { connectDevframe } from 'devframe/client'
import { shallowRef } from 'vue'

/** What pages talk to; they do not know whether a live server or a static dump answers. */
export interface UiBackend {
  readonly mode: 'server' | 'static'
  readonly capabilities: { readonly write: boolean, readonly prompts: boolean, readonly openInEditor: boolean }
  readonly project: () => Promise<ProjectList>
  readonly keys: (project: string) => Promise<KeyTable>
  readonly key: (project: string, key: string) => Promise<KeyDetail | null>
  readonly usages: (project: string) => Promise<UsageView[]>
  readonly analysis: (project: string) => Promise<AnalysisView>
  readonly diagnostics: (project: string, query: Omit<DiagnosticQuery, 'project'>) => Promise<DiagnosticPage>
  /** Every review thread, resolved comments included. */
  readonly reviews: (project: string) => Promise<ReviewThread[]>
  readonly explain: () => Promise<ExplainList>
  readonly extractCandidates: (project: string) => Promise<ExtractSelection[]>
  readonly plan: (query: PlanQuery) => Promise<PlanView>
  readonly apply: (query: ApplyQuery) => Promise<ApplyView>
  readonly extractSelected: (query: ExtractSelectionQuery) => Promise<ApplyView>
  readonly extractApply: (query: ExtractApplyQuery) => Promise<ApplyView>
  /** Dry run of the bulk delete of unused keys; writes with `confirm`. */
  readonly deleteUnused: (query: UnusedDeletionQuery) => Promise<UnusedDeletionView>
  readonly openInEditor: (query: OpenQuery) => Promise<void>
  /** Calls back with the new state after any change in any project. */
  readonly onChange: (listener: (state: X18nState) => void) => () => void
}

// Static dumps are keyed by the exact arguments, so reads always pass `{ project }` and nothing else,
// and diagnostics pass the fields of a query only when set, with `page` always (see `diagnosticQueries`).
function reads(rpc: DevframeRpcClient): Pick<UiBackend, 'project' | 'keys' | 'key' | 'usages' | 'analysis' | 'diagnostics' | 'reviews' | 'explain' | 'extractCandidates'> {
  return {
    project: () => rpc.call('x18n:project'),
    keys: project => rpc.call('x18n:keys', { project }),
    key: (project, key) => rpc.call('x18n:key', { project, key }),
    usages: project => rpc.call('x18n:usages', { project }),
    analysis: project => rpc.call('x18n:analysis', { project }),
    diagnostics: (project, { codes, locale, page }) => rpc.call('x18n:diagnostics', {
      project,
      ...codes && { codes },
      ...locale !== undefined && { locale },
      page: page ?? 0,
    }),
    reviews: project => rpc.call('x18n:reviews', { project }),
    explain: () => rpc.call('x18n:explain'),
    extractCandidates: project => rpc.call('x18n:extract-selections', { project }),
  }
}

function readOnly(): never {
  throw new Error('This report is read-only.')
}

function staticBackend(rpc: DevframeRpcClient): UiBackend {
  return {
    mode: 'static',
    capabilities: { write: false, prompts: false, openInEditor: false },
    ...reads(rpc),
    plan: readOnly,
    apply: readOnly,
    extractApply: readOnly,
    extractSelected: readOnly,
    deleteUnused: readOnly,
    openInEditor: readOnly,
    onChange: () => () => {},
  }
}

async function serverBackend(rpc: DevframeRpcClient): Promise<UiBackend> {
  const { openInEditor } = await rpc.call('x18n:project')
  const state = await rpc.sharedState.get<X18nState>('x18n:state')
  return {
    mode: 'server',
    capabilities: { write: true, prompts: true, openInEditor },
    ...reads(rpc),
    plan: query => rpc.call('x18n:plan', query),
    apply: query => rpc.call('x18n:apply', query),
    extractApply: query => rpc.call('x18n:extract-apply', query),
    extractSelected: query => rpc.call('x18n:extract-selected', query),
    deleteUnused: query => rpc.call('x18n:delete-unused', query),
    openInEditor: query => rpc.call('x18n:open-in-editor', query),
    onChange: listener => state.on('updated', value => listener(value)),
  }
}

/** Set while the server waits for the one-time code; exchange it with `authenticate`. */
export const pendingAuth = shallowRef<((code: string) => Promise<boolean>) | undefined>()

async function trust(rpc: DevframeRpcClient): Promise<void> {
  const code = sessionStorage.getItem('x18n:otp')
  sessionStorage.removeItem('x18n:otp')
  if (code && await rpc.requestTrustWithCode(code))
    return
  if (rpc.isTrusted || await rpc.requestTrust())
    return
  // The server prints the code only on request; `x18n ui` already printed one at startup, and it prints each code once.
  await rpc.requestAuthCode()
  await new Promise<void>((resolve) => {
    pendingAuth.value = async (typed) => {
      const ok = await rpc.requestTrustWithCode(typed)
      if (ok) {
        pendingAuth.value = undefined
        resolve()
      }
      return ok
    }
  })
}

let connecting: Promise<UiBackend> | undefined

export function useBackend(): Promise<UiBackend> {
  connecting ??= connectDevframe({ otpParam: false, simpleAuth: false }).then(async (rpc) => {
    if (rpc.transport === 'static')
      return staticBackend(rpc)
    await trust(rpc)
    return serverBackend(rpc)
  })
  return connecting
}
