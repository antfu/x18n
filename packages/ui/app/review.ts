// @unocss-include
import type { MessageState, ReviewState, ReviewType } from '@x18n/core'
import type { MessageKey } from './i18n'

export const reviewStates: Readonly<Record<ReviewState, { readonly label: MessageKey, readonly icon: string, readonly color: string }>> = {
  'changes-requested': { label: /* @x18n-key */ 'review.states.changesRequested', icon: 'i-ph-note-pencil-duotone', color: 'color-warn' },
  'approved': { label: /* @x18n-key */ 'review.states.approved', icon: 'i-ph-check-circle-duotone', color: 'color-ok' },
  'stale-approval': { label: /* @x18n-key */ 'review.states.staleApproval', icon: 'i-ph-clock-counter-clockwise-duotone', color: 'color-warn' },
  'suggested': { label: /* @x18n-key */ 'review.states.suggested', icon: 'i-ph-lightbulb-duotone', color: 'color-info' },
  'commented': { label: /* @x18n-key */ 'review.states.commented', icon: 'i-ph-chat-circle-text-duotone', color: 'color-muted' },
}

/** Translation states that formats report, in the order a translation moves through them. */
export const messageStates: Readonly<Record<MessageState, { readonly label: MessageKey, readonly icon: string, readonly color: string }>> = {
  'translated': { label: /* @x18n-key */ 'state.translated', icon: 'i-ph-circle-half-duotone', color: 'color-muted' },
  'needs-review': { label: /* @x18n-key */ 'state.needsReview', icon: 'i-ph-eye-duotone', color: 'color-info' },
  'reviewed': { label: /* @x18n-key */ 'state.reviewed', icon: 'i-ph-seal-check-duotone', color: 'color-ok' },
}

export const reviewTypes: Readonly<Record<ReviewType, { readonly label: MessageKey, readonly done: MessageKey, readonly icon: string, readonly color: string }>> = {
  'comment': {
    label: /* @x18n-key */ 'review.types.comment',
    done: /* @x18n-key */ 'review.done.comment',
    icon: 'i-ph-chat-circle-text-duotone',
    color: 'color-muted',
  },
  'approve': {
    label: /* @x18n-key */ 'review.types.approve',
    done: /* @x18n-key */ 'review.done.approve',
    icon: 'i-ph-check-circle-duotone',
    color: 'color-ok',
  },
  'request-change': {
    label: /* @x18n-key */ 'review.types.requestChange',
    done: /* @x18n-key */ 'review.done.requestChange',
    icon: 'i-ph-note-pencil-duotone',
    color: 'color-warn',
  },
  'suggestion': {
    label: /* @x18n-key */ 'review.types.suggestion',
    done: /* @x18n-key */ 'review.done.suggestion',
    icon: 'i-ph-lightbulb-duotone',
    color: 'color-info',
  },
}

export const reviewTypeOrder: readonly ReviewType[] = [
  'comment',
  'approve',
  'request-change',
  'suggestion',
]
