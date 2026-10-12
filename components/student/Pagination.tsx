// Shared Student App pagination: bounded desktop numbers and mobile page position.
'use client'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from './ui'
import type { RefObject } from 'react'

type PageItem = number | 'before' | 'after'
type Props = {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  label?: string
  scrollTarget?: RefObject<HTMLElement | null>
}

function pageItems(page: number, total: number): PageItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const first = Math.max(2, Math.min(page - 1, total - 3))
  const last = Math.min(total - 1, Math.max(page + 1, 4))
  const items: PageItem[] = [1]
  if (first === 3) items.push(2)
  else if (first > 3) items.push('before')
  for (let value = first; value <= last; value++) items.push(value)
  if (last === total - 2) items.push(total - 1)
  else if (last < total - 2) items.push('after')
  items.push(total)
  return items
}

/** Order only presentation pages; keep disabled controls real and focus in the new results. */
export function Pagination({ page, totalPages, onPageChange, label = 'Results pages', scrollTarget }: Props) {
  if (totalPages <= 1) return null
  const current = Math.max(1, Math.min(page, totalPages))
  const changePage = (next: number) => {
    if (next < 1 || next > totalPages || next === current) return
    onPageChange(next)
    if (scrollTarget) requestAnimationFrame(() => {
      const target = scrollTarget.current
      target?.focus({ preventScroll: true })
      target?.scrollIntoView({ block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    })
  }
  return <nav className="student-pagination" aria-label={label}>
    <button type="button" className={studentAction(btnGhost)} disabled={current === 1}
      onClick={() => changePage(current - 1)}>Previous</button>
    <p className="student-pagination-position" aria-live="polite" aria-atomic="true">Page {current} of {totalPages}</p>
    <ol className="student-pagination-numbers">
      {pageItems(current, totalPages).map(item => <li key={item}>
        {typeof item === 'number'
          ? <button type="button" aria-label={`Page ${item}`}
            aria-current={item === current ? 'page' : undefined}
            className={studentAction(item === current ? btnNavy : btnGhost,
              item === current && studentFocusDark, 'student-pagination-number')}
            onClick={() => changePage(item)}>{item}</button>
          : <span aria-hidden="true" className="student-pagination-gap">…</span>}
      </li>)}
    </ol>
    <button type="button" className={studentAction(btnGhost)} disabled={current === totalPages}
      onClick={() => changePage(current + 1)}>Next</button>
  </nav>
}
