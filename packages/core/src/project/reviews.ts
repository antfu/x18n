import type { KeyString, LocaleCode, MessageLeaf } from '../types/model'
import type { MachineRecord, ReviewComment, ReviewData, ReviewFilter, ReviewState, ReviewThread, ThreadComment } from '../types/review'
import { hashText } from '../text'

export const noReviews: ReviewData = { threads: {}, sources: {}, machine: {} }

/** What a review compares: message values as text. */
export function valueText(value: MessageLeaf): string {
  return value === null
    ? ''
    : String(value)
}

/** The hash recorded for a machine-translated value in `machine`. */
export function valueHash(value: MessageLeaf): string {
  return hashText(valueText(value))
}

/**
 * The machine record of a message while it holds: the current value is the one the translator wrote,
 * and no open approval approved it.
 */
export function machineOf(data: ReviewData, key: KeyString, locale: LocaleCode, current: MessageLeaf | undefined): MachineRecord | undefined {
  const record = data.machine?.[key]?.[locale]
  if (!record || current === undefined || record.value !== valueHash(current))
    return undefined
  const text = valueText(current)
  const approved = (data.threads[key]?.[locale] ?? []).some(c => c.type === 'approve' && !c.resolved && c.value === text)
  return approved
    ? undefined
    : record
}

/** The hash recorded for a source value in `sources`. */
export function sourceHash(value: MessageLeaf): string {
  return hashText(JSON.stringify(value))
}

function reviewState(comments: readonly ThreadComment[]): ReviewState | undefined {
  const open = comments.filter(comment => !comment.resolved)
  const decisive = open.findLast(comment => comment.type === 'approve' || comment.type === 'request-change')
  if (decisive) {
    return decisive.type === 'request-change'
      ? 'changes-requested'
      : decisive.stale
        ? 'stale-approval'
        : 'approved'
  }
  if (open.some(comment => comment.type === 'suggestion'))
    return 'suggested'
  return open.length > 0
    ? 'commented'
    : undefined
}

/** A short random id that `taken` does not know. */
export function reviewId(taken: (id: string) => boolean): string {
  let id: string
  do
    id = Math.random().toString(36).slice(2, 8)
  while (id.length < 6 || taken(id))
  return id
}

function byCode(a: string, b: string): number {
  return a < b
    ? -1
    : a > b
      ? 1
      : 0
}

/** Threads in key order, then in the order of `locales`, then any other locale. */
export function listThreads(data: ReviewData, filter: ReviewFilter, locales: readonly LocaleCode[], current: (key: KeyString, locale: LocaleCode) => MessageLeaf | undefined): ReviewThread[] {
  const rank = (locale: LocaleCode): number => {
    const i = locales.indexOf(locale)
    return i < 0
      ? locales.length
      : i
  }
  const out: ReviewThread[] = []
  const keys = filter.key === undefined
    ? Object.keys(data.threads).sort(byCode)
    : [filter.key]
  for (const key of keys) {
    const byLocale = data.threads[key] ?? {}
    const codes = Object.keys(byLocale)
      .filter(locale => filter.locale === undefined || locale === filter.locale)
      .sort((a, b) => rank(a) - rank(b) || byCode(a, b))
    for (const locale of codes) {
      const value = current(key, locale)
      const comments = byLocale[locale]!
        .filter(comment => !filter.open || !comment.resolved)
        .map((comment): ThreadComment => ({
          ...comment,
          stale: comment.type === 'approve' && comment.value !== undefined && value !== undefined && valueText(value) !== comment.value,
        }))
      if (comments.length > 0) {
        out.push({
          key,
          locale,
          comments,
          state: reviewState(comments),
        })
      }
    }
  }
  return out
}

export function findReview(data: ReviewData, id: string): { key: KeyString, locale: LocaleCode, comment: ReviewComment } | undefined {
  for (const [key, byLocale] of Object.entries(data.threads)) {
    for (const [locale, comments] of Object.entries(byLocale)) {
      const comment = comments.find(c => c.id === id)
      if (comment)
        return { key, locale, comment }
    }
  }
  return undefined
}

interface Section<T> { readonly [key: KeyString]: { readonly [locale: LocaleCode]: T } }

function sortSection<T>(section: Section<T>): Section<T> {
  return Object.fromEntries(Object.entries(section)
    .filter(([, byLocale]) => Object.keys(byLocale).length > 0)
    .sort(([a], [b]) => byCode(a, b))
    .map(([key, byLocale]) => [
      key,
      Object.fromEntries(Object.entries(byLocale).sort(([a], [b]) => byCode(a, b))),
    ]))
}

/** Sorted keys and locales, so edits from two branches merge well. */
export function sortReviews(data: ReviewData): ReviewData {
  return {
    threads: sortSection(data.threads),
    sources: sortSection(data.sources),
    machine: sortSection(data.machine ?? {}),
  }
}

function rekey<T>(section: Section<T>, from: KeyString, to: KeyString): Section<T> {
  const { [from]: entry, ...rest } = section
  return entry
    ? { ...rest, [to]: entry }
    : section
}

function without<T>(section: Section<T>, key: KeyString, locales: 'all' | readonly LocaleCode[]): Section<T> {
  const { [key]: byLocale, ...rest } = section
  if (!byLocale || locales === 'all')
    return rest
  return {
    ...rest,
    [key]: Object.fromEntries(Object.entries(byLocale).filter(([locale]) => !locales.includes(locale))),
  }
}

/** Review data being changed by an edit plan. */
export class ReviewDraft {
  changed = false

  constructor(public data: ReviewData) {}

  private update(next: ReviewData): void {
    this.changed = true
    this.data = next
  }

  private thread(key: KeyString, locale: LocaleCode, comments: readonly ReviewComment[]): void {
    const { threads } = this.data
    this.update({
      ...this.data,
      threads: {
        ...threads,
        [key]: { ...threads[key], [locale]: comments },
      },
    })
  }

  add(key: KeyString, locale: LocaleCode, comment: ReviewComment): void {
    this.thread(key, locale, [
      ...this.data.threads[key]?.[locale] ?? [],
      comment,
    ])
  }

  resolve(id: string): void {
    const found = findReview(this.data, id)
    if (found) {
      this.thread(found.key, found.locale, this.data.threads[found.key]![found.locale]!.map(c => c.id === id
        ? { ...c, resolved: true }
        : c))
    }
  }

  record(key: KeyString, locale: LocaleCode, hash: string): void {
    const { sources } = this.data
    if (sources[key]?.[locale] !== hash) {
      this.update({
        ...this.data,
        sources: {
          ...sources,
          [key]: { ...sources[key], [locale]: hash },
        },
      })
    }
  }

  recordMachine(key: KeyString, locale: LocaleCode, record: MachineRecord): void {
    const machine = this.data.machine ?? {}
    this.update({
      ...this.data,
      machine: {
        ...machine,
        [key]: { ...machine[key], [locale]: record },
      },
    })
  }

  /** Threads and records follow a renamed key. */
  move(from: KeyString, to: KeyString): void {
    const machine = this.data.machine ?? {}
    if (this.data.threads[from] || this.data.sources[from] || machine[from]) {
      this.update({
        threads: rekey(this.data.threads, from, to),
        sources: rekey(this.data.sources, from, to),
        machine: rekey(machine, from, to),
      })
    }
  }

  remove(key: KeyString, locales: 'all' | readonly LocaleCode[]): void {
    const machine = this.data.machine ?? {}
    if (this.data.threads[key] || this.data.sources[key] || machine[key]) {
      this.update({
        threads: without(this.data.threads, key, locales),
        sources: without(this.data.sources, key, locales),
        machine: without(machine, key, locales),
      })
    }
  }
}
