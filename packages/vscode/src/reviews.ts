import type { ReviewCommentInfo, ReviewThreadInfo } from '@x18n/lsp'
import type { Comment, CommentThread, Event } from 'vscode'
import type { X18nClient } from './model/client'
import { commands as serverCommands } from '@x18n/lsp'
import { useCommand, useDisposable } from 'reactive-vscode'
import { CommentMode, comments, CommentThreadCollapsibleState, CommentThreadState, MarkdownString, Range, Uri, window } from 'vscode'
import { commands } from './generated/meta'
import { l10n } from './model/l10n'
import { reviewState, reviewTypeLabel } from './model/tree'

interface ReviewComment extends Comment {
  readonly review: ReviewCommentInfo
  readonly project: string
}

function toComment(thread: ReviewThreadInfo, review: ReviewCommentInfo): ReviewComment {
  const body = [
    review.text,
    review.suggestion === undefined
      ? undefined
      : l10n.t('Suggests `{0}`', review.suggestion),
  ].filter(Boolean).join('\n\n')
  return {
    body: new MarkdownString(body || `_${reviewTypeLabel(review.type)}_`),
    mode: CommentMode.Preview,
    author: { name: review.author?.name ?? review.author?.email ?? l10n.t('unknown') },
    label: [
      reviewTypeLabel(review.type),
      review.resolved && l10n.t('resolved'),
      review.stale && l10n.t('value changed since'),
    ].filter(Boolean).join(' · '),
    timestamp: new Date(review.time),
    contextValue: `x18n.review.${review.type}.${review.resolved ? 'resolved' : 'open'}`,
    review,
    project: thread.project,
  }
}

function isReviewComment(value: unknown): value is ReviewComment {
  return typeof value === 'object' && value !== null && 'review' in value && 'project' in value
}

/** Review threads as editor comments on the resource line of each locale, with reply, approve, suggest and resolve. */
export function useReviews(x18n: X18nClient, execute: (command: string, arg: object) => Promise<unknown>, refresh: Event<void>): void {
  const controller = useDisposable(comments.createCommentController('x18n.reviews', l10n.t('x18n reviews')))
  const threads = new Map<CommentThread, ReviewThreadInfo>()
  let shown = ''
  controller.commentingRangeProvider = {
    provideCommentingRanges: document => [
      ...threads.keys(),
    ].filter(t => t.uri.toString() === document.uri.toString() && t.range).map(t => t.range!),
  }

  async function reload(): Promise<void> {
    const { threads: list } = await x18n.request('x18n/reviews', {})
    // Every `x18n/changed` lands here; recreating unchanged threads would close them and drop reply drafts.
    const next = JSON.stringify(list)
    if (next === shown)
      return
    shown = next
    threads.forEach((_, thread) => thread.dispose())
    threads.clear()
    for (const info of list) {
      if (!info.location)
        continue
      const { start, end } = info.location.range
      const thread = controller.createCommentThread(Uri.parse(info.location.uri), new Range(start.line, start.character, end.line, end.character), info.comments.map(c => toComment(info, c)))
      thread.label = `${info.locale} · ${info.state
        ? reviewState(info.state).label
        : l10n.t('resolved')}`
      thread.state = info.state ? CommentThreadState.Unresolved : CommentThreadState.Resolved
      thread.collapsibleState = info.state === 'changes-requested'
        ? CommentThreadCollapsibleState.Expanded
        : CommentThreadCollapsibleState.Collapsed
      threads.set(thread, info)
    }
  }
  useDisposable(refresh(() => void reload().catch(() => undefined)))

  const register = (command: string, run: (arg: unknown) => Promise<unknown>): void => {
    useCommand(command, (arg: unknown) => run(arg).catch(error => window.showErrorMessage(`x18n: ${error instanceof Error
      ? error.message
      : String(error)}`)))
  }
  const reply = (review: ReviewCommentInfo['type']) => async (arg: unknown): Promise<void> => {
    const thread = typeof arg === 'object' && arg !== null && 'thread' in arg && 'text' in arg && typeof arg.text === 'string'
      ? {
          info: threads.get(arg.thread as CommentThread),
          text: arg.text.trim(),
        } // `CommentReply`, as VS Code passes it to reply commands
      : undefined
    if (!thread?.info)
      return
    if (!thread.text && review !== 'approve') {
      void window.showWarningMessage(review === 'suggestion'
        ? l10n.t('x18n: type the suggested value first.')
        : l10n.t('x18n: type a comment first.'))
      return
    }
    const { project, key, locale } = thread.info
    await execute(serverCommands.review, {
      project,
      key,
      locale,
      review,
      ...review === 'suggestion'
        ? { suggestion: thread.text }
        : thread.text
          ? { text: thread.text }
          : {},
    })
  }
  register(commands.replyReview, reply('comment'))
  register(commands.approveReview, reply('approve'))
  register(commands.requestReviewChange, reply('request-change'))
  register(commands.suggestReview, reply('suggestion'))
  register(commands.resolveReviewComment, async (arg) => {
    if (isReviewComment(arg))
      await execute(serverCommands.resolveReview, { project: arg.project, id: arg.review.id })
  })
  register(commands.applyReviewSuggestion, async (arg) => {
    if (isReviewComment(arg))
      await execute(serverCommands.applySuggestion, { project: arg.project, id: arg.review.id })
  })
}
