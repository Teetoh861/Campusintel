// app/courses/[slug]/quiz/ReviewScreen.tsx — Paged answer review for this attempt, reset on every entry.
'use client'

import { useId, useRef, useState } from 'react'
import { btnGhost } from '@/components/chrome/ui'
import { EmptyState } from '@/components/student/EmptyState'
import { PageBand } from '@/components/student/PageBand'
import { Pagination } from '@/components/student/Pagination'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction } from '@/components/student/ui'
import { useIsDesktop } from '@/components/ui/use-mobile'
import { ReviewCard, reviewStatus } from './ReviewCard'
import { practiceIdentity } from './practice-presentation'
import type { ReturnFocus } from './focus-return'
import type { GradedQuestion, ReviewFilter } from './types'
import type { ReactElement } from 'react'

export const REVIEW_PAGE_SIZE = { compact: 5, desktop: 10 } as const
const FILTERS: ReadonlyArray<ReviewFilter> = ['all', 'to-review', 'correct']

type Props = {
  courseCode: string
  courseTitle: string
  repositoryOnly: boolean
  // The graded attempt's questions: correct options and explanations exist only once the server has graded it.
  questions: ReadonlyArray<GradedQuestion>
  correctCount: number
  reported: Readonly<Record<string, true>>
  // The question index whose report dialog is open, or null: that exact item must stay mounted through any re-paging.
  reporting: number | null
  onReport: (index: number, returnFocusTo: ReturnFocus) => void
  onBack: () => void
}

/** Filter, page and disclosure live here, so leaving and re-entering review always starts at All, page 1, collapsed. */
export function ReviewScreen(props: Props): ReactElement {
  const { questions, correctCount, reported, reporting } = props
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [page, setPage] = useState(1)
  // Expansion order, oldest first; desktop may hold several, narrower viewports keep only the most recent.
  const [expanded, setExpanded] = useState<ReadonlyArray<number>>([])
  const desktop = useIsDesktop()
  const pageSize = desktop ? REVIEW_PAGE_SIZE.desktop : REVIEW_PAGE_SIZE.compact
  // Below 1200 one disclosure survives: the item whose report dialog is open, otherwise the most recent.
  const open = desktop ? expanded : reporting !== null && expanded.includes(reporting) ? [reporting] : expanded.slice(-1)
  // Converge state in the same render as the crossing, so returning to desktop never reopens the others.
  if (open.length !== expanded.length) setExpanded(open)
  const rangeHeading = useRef<HTMLHeadingElement>(null)
  const id = useId()
  const identity = practiceIdentity(props.courseCode, props.courseTitle, props.repositoryOnly)

  const items = questions.map((question, index) => ({ question, index, status: reviewStatus(question) }))
  const total = items.length
  const toReview = items.filter(item => item.status !== 'correct').length
  const filtered = items.filter(item => filter === 'all' ? true : filter === 'correct' ? item.status === 'correct' : item.status !== 'correct')
  // The page size this page was chosen under. When a crossing changes it while a report is open, re-page to the page
  // holding that exact item in this same render, before any slice commits, so the item and its controls never unmount.
  const [pagedAt, setPagedAt] = useState(pageSize)
  if (pagedAt !== pageSize) {
    setPagedAt(pageSize)
    const position = reporting === null ? -1 : filtered.findIndex(item => item.index === reporting)
    if (position >= 0) setPage(Math.floor(position / pageSize) + 1)
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, totalPages)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)
  const first = filtered.length === 0 ? 0 : (current - 1) * pageSize + 1
  const last = Math.min(current * pageSize, filtered.length)
  const rangeLine = `Questions ${first}–${last} of ${filtered.length}`
  const unansweredCount = items.filter(item => item.status === 'unanswered').length
  const note = filter === 'to-review' ? `${toReview - unansweredCount} incorrect and ${unansweredCount} unanswered.`
    : filter === 'correct' ? `${correctCount} questions answered correctly.`
    : 'Every question in this attempt, in the order you saw them.'

  const changeFilter = (next: ReviewFilter) => { setFilter(next); setPage(1); setExpanded([]) }
  const changePage = (next: number) => { setPage(next); setExpanded([]) }
  const toggle = (index: number) => setExpanded(current => {
    if (current.includes(index)) return current.filter(item => item !== index)
    return desktop ? [...current, index] : [index]
  })
  const labels: Record<ReviewFilter, string> = { all: `All ${total}`, 'to-review': `To review ${toReview}`, correct: `Correct ${correctCount}` }

  return <StudentPage band={<PageBand title="Answer review" lede={`${correctCount} of ${total} correct in this attempt`} context={<p>{identity.context}</p>} />}>
    <div className="max-w-[760px]">
      <div className="student-practice-filters">
        <fieldset className="student-practice-choice">
          <legend>Show</legend>
          {FILTERS.map(value => <label key={value} className="student-practice-choice-option">
            <input type="radio" name={`${id}-filter`} value={value} checked={filter === value} onChange={() => changeFilter(value)} />
            <span>{labels[value]}</span>
          </label>)}
        </fieldset>
        <button type="button" className={studentAction(btnGhost, 'border-transparent')} onClick={props.onBack}>Back to result</button>
      </div>
      <p className="student-practice-help" aria-live="polite">{note}</p>
    </div>
    {filtered.length === 0 ? <div className="mt-5 max-w-[760px]">
      <EmptyState title={filter === 'correct' ? 'No correct answers in this attempt.' : 'Nothing to review.'}
        actions={<button type="button" className={studentAction(btnGhost, 'bg-student-surface')} onClick={() => changeFilter('all')}>Show all questions</button>}>
        {filter === 'correct' ? 'Every question in this attempt was answered incorrectly or left unanswered.' : 'Every question in this attempt was answered correctly.'}
      </EmptyState>
    </div> : <>
      <h2 ref={rangeHeading} tabIndex={-1} className="sr-only">{rangeLine}</h2>
      <ol className="student-practice-review">
        {visible.map(item => <ReviewCard key={item.index} question={item.question} n={item.index + 1}
          status={item.status} open={open.includes(item.index)} reported={Boolean(reported[item.question.questionId])}
          onToggle={() => toggle(item.index)} onReport={returnFocusTo => props.onReport(item.index, returnFocusTo)} />)}
      </ol>
      <Pagination page={current} totalPages={totalPages} onPageChange={changePage} label="Review pages" scrollTarget={rangeHeading} />
      {totalPages > 1 ? <p className="student-practice-help max-w-[760px] text-center">{rangeLine}</p> : null}
    </>}
  </StudentPage>
}
