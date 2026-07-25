// CourseDirectory — Variant B client island for /courses. Owns the search
// query + three segmented filters (level, semester, difficulty) and renders the
// sticky filter bar, result count, reused homepage .ccard grid and empty state.
// Visual reskin only: the filter behaviour is unchanged from the dossier
// version. Card markup is precomputed on the server (cardProps).
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, type CardProps } from '@/components/chrome/Card'
import { btnBase, btnGhost, btnSm, cx } from '@/components/chrome/ui'
import type { Course } from '@/lib/types'

export type DirectoryItem = {
  id: string
  cardProps: CardProps
  filter: {
    code: string
    title: string
    level: number
    semester: number
    difficulty: Course['difficulty']
  }
}

type LevelFilter = 'all' | '100' | '200'
type SemesterFilter = 'all' | 'first' | 'second'
type DifficultyFilter = 'all' | 'easy' | 'medium' | 'hard'

type Option<T extends string> = { val: T; label: string }

const LEVEL_OPTIONS: ReadonlyArray<Option<LevelFilter>> = [
  { val: 'all', label: 'All' },
  { val: '100', label: '100' },
  { val: '200', label: '200' },
]
const SEMESTER_OPTIONS: ReadonlyArray<Option<SemesterFilter>> = [
  { val: 'all', label: 'All' },
  { val: 'first', label: 'First' },
  { val: 'second', label: 'Second' },
]
const DIFFICULTY_OPTIONS: ReadonlyArray<Option<DifficultyFilter>> = [
  { val: 'all', label: 'All' },
  { val: 'easy', label: 'Easy' },
  { val: 'medium', label: 'Medium' },
  { val: 'hard', label: 'Hard' },
]

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

type Props = {
  items: ReadonlyArray<DirectoryItem>
  totalCount: number
}

export function CourseDirectory({ items, totalCount }: Props) {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [semester, setSemester] = useState<SemesterFilter>('all')
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('all')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(6)
  const directoryTopRef = useRef<HTMLDivElement>(null)

  const trimmed = query.trim()
  const activeFilterCount = [level, semester, difficulty].filter((v) => v !== 'all').length
  const isFiltered =
    trimmed !== '' || level !== 'all' || semester !== 'all' || difficulty !== 'all'

  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase()
    return items.filter(({ filter }) => {
      if (level !== 'all' && String(filter.level) !== level) return false
      if (semester !== 'all') {
        const wantSemester = semester === 'first' ? 1 : 2
        if (filter.semester !== wantSemester) return false
      }
      if (difficulty !== 'all' && filter.difficulty.toLowerCase() !== difficulty)
        return false
      if (q) {
        const code = filter.code.toLowerCase()
        const title = filter.title.toLowerCase()
        if (!code.includes(q) && !title.includes(q)) return false
      }
      return true
    })
  }, [items, trimmed, level, semester, difficulty])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 900px)')
    const updatePerPage = () => setPerPage(desktop.matches ? 9 : 6)
    updatePerPage()
    desktop.addEventListener('change', updatePerPage)
    return () => desktop.removeEventListener('change', updatePerPage)
  }, [])

  useEffect(() => {
    setPage(1)
  }, [query, level, semester, difficulty])

  const totalPages = Math.ceil(filtered.length / perPage)
  const visibleItems = filtered.slice((page - 1) * perPage, page * perPage)

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(totalPages, 1)))
  }, [totalPages])

  const changePage = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page) return
    setPage(nextPage)
    requestAnimationFrame(() => {
      directoryTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const reset = () => {
    setQuery('')
    setLevel('all')
    setSemester('all')
    setDifficulty('all')
  }

  return (
    <>
      {/* ===================== STICKY SEARCH + FILTERS ===================== */}
      <div
        ref={directoryTopRef}
        className="scroll-mt-[74px] border-b border-ci-border bg-ci-paper/[0.92] backdrop-blur-[12px] min-[900px]:sticky min-[900px]:top-[74px] min-[900px]:z-40"
        data-screen-label="Search and filter"
      >
        <div className={WRAP}>
          <div className="flex flex-col gap-[14px] py-4 min-[900px]:flex-row min-[900px]:flex-wrap min-[900px]:items-center min-[900px]:gap-5 min-[900px]:py-[18px]">
            {/* search */}
            <label className="flex min-h-[52px] items-center gap-3 rounded-[11px] border border-ci-border-2 bg-ci-white px-4 py-3 transition-[border-color,box-shadow] duration-150 focus-within:border-ci-navy focus-within:shadow-[0_0_0_3px_var(--ci-blue-50)] min-[900px]:flex-[1_1_280px] min-[900px]:min-w-[260px]">
              <MagnifyingGlass />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a course code or title"
                aria-label="Search courses by code or title"
                autoComplete="off"
                maxLength={100}
                className="min-w-0 flex-1 border-0 bg-transparent text-[15.5px] text-ci-ink outline-none placeholder:text-ci-gray-400"
              />
              {query !== '' ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                  className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-[6px] text-[18px] leading-none text-ci-gray-500 transition-colors hover:bg-ci-paper-2 hover:text-ci-ink"
                >
                  &times;
                </button>
              ) : null}
            </label>

            {/* filters + count */}
            <div className="flex flex-wrap items-center gap-x-[22px] gap-y-[18px] min-[900px]:flex-[2_1_100%] min-[900px]:gap-y-[14px]">
              {/* Mobile: native themed dropdowns. */}
              <div className="order-1 flex w-full flex-col gap-4 min-[900px]:hidden">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-ci-navy-900">Filter courses</span>
                  {activeFilterCount > 0 ? (
                    <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-ci-navy px-[6px] text-[12px] font-bold leading-none text-white [font-variant-numeric:tabular-nums]">
                      {activeFilterCount}
                    </span>
                  ) : null}
                </div>
                <FilterSelect
                  id="mobile-level-filter"
                  label="Level"
                  value={level}
                  options={LEVEL_OPTIONS}
                  onChange={setLevel}
                />
                <FilterSelect
                  id="mobile-semester-filter"
                  label="Semester"
                  value={semester}
                  options={SEMESTER_OPTIONS}
                  onChange={setSemester}
                />
                <FilterSelect
                  id="mobile-difficulty-filter"
                  label="Difficulty"
                  value={difficulty}
                  options={DIFFICULTY_OPTIONS}
                  onChange={setDifficulty}
                />
              </div>

              {/* Desktop: retain the existing inline segmented controls. */}
              <div id="course-filters-panel" className="hidden min-[900px]:contents">
                <Seg label="Level" value={level} options={LEVEL_OPTIONS} onChange={setLevel} />
                <Seg label="Semester" value={semester} options={SEMESTER_OPTIONS} onChange={setSemester} />
                <Seg label="Difficulty" value={difficulty} options={DIFFICULTY_OPTIONS} onChange={setDifficulty} />
              </div>

              <div className="order-2 ml-auto flex items-center gap-4">
                <span className="text-[13.5px] font-medium text-ci-gray-600">
                  Showing <b className="font-bold text-ci-navy-900">{filtered.length}</b> of {totalCount}
                </span>
                {isFiltered ? (
                  <button
                    type="button"
                    onClick={reset}
                    className="text-[13.5px] font-semibold text-ci-navy transition-colors hover:text-ci-navy-700"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===================== GRID / EMPTY ===================== */}
      <section className="pb-20 pt-10 min-[900px]:pt-12" data-screen-label="Course grid">
        <div className={WRAP}>
          {filtered.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-5 min-[900px]:grid-cols-3 min-[900px]:gap-6">
                {visibleItems.map((item) => (
                  <Card key={item.id} {...item.cardProps} />
                ))}
              </div>

              {totalPages > 1 ? (
                <nav
                  className="mt-8 flex flex-wrap items-center justify-center gap-2"
                  aria-label="Course directory pages"
                >
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() => changePage(page - 1)}
                    className="inline-flex min-h-10 items-center justify-center rounded-[9px] border border-ci-border-2 bg-ci-white px-3 text-[13.5px] font-semibold text-ci-navy transition-colors hover:border-ci-blue-200 hover:bg-ci-paper-2 disabled:pointer-events-none disabled:opacity-40"
                  >
                    Previous
                  </button>
                  {Array.from({ length: totalPages }, (_, index) => {
                    const pageNumber = index + 1
                    const isCurrent = pageNumber === page
                    return (
                      <button
                        key={pageNumber}
                        type="button"
                        aria-current={isCurrent ? 'page' : undefined}
                        onClick={() => changePage(pageNumber)}
                        className={cx(
                          'inline-flex h-10 min-w-10 items-center justify-center rounded-[9px] border px-3 text-[13.5px] font-bold transition-colors',
                          isCurrent
                            ? 'border-ci-navy bg-ci-navy text-white'
                            : 'border-ci-border-2 bg-ci-white text-ci-navy hover:border-ci-blue-200 hover:bg-ci-paper-2',
                        )}
                      >
                        {pageNumber}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    disabled={page === totalPages}
                    onClick={() => changePage(page + 1)}
                    className="inline-flex min-h-10 items-center justify-center rounded-[9px] border border-ci-border-2 bg-ci-white px-3 text-[13.5px] font-semibold text-ci-navy transition-colors hover:border-ci-blue-200 hover:bg-ci-paper-2 disabled:pointer-events-none disabled:opacity-40"
                  >
                    Next
                  </button>
                </nav>
              ) : null}
            </>
          ) : (
            <div className="rounded-[20px] border border-dashed border-ci-border-2 bg-ci-paper-2 p-[56px_28px] text-center">
              <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-ci-gray-500">No matches</div>
              <h3 className="mt-[14px] text-[26px] font-extrabold tracking-[-0.02em] text-ci-navy-900">
                Nothing for{' '}
                <span className="font-bold text-ci-navy">{trimmed ? `“${trimmed}”` : 'that'}</span>
              </h3>
              <p className="mx-auto mt-3 max-w-[42ch] text-[15px] leading-[1.55] text-ci-gray-600">
                No course matches your search and filters. Clear them to see all {totalCount} courses, or
                check back as coverage expands.
              </p>
              <div className="mt-6 inline-flex">
                <button type="button" onClick={reset} className={cx(btnBase, btnSm, btnGhost)}>
                  Reset filters
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}

type SegProps<T extends string> = {
  label: string
  value: T
  options: ReadonlyArray<Option<T>>
  onChange: (val: T) => void
}

type FilterSelectProps<T extends string> = SegProps<T> & {
  id: string
}

function FilterSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: FilterSelectProps<T>) {
  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ci-gray-500">
        {label}
      </span>
      <span className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => {
            const selected = options.find((option) => option.val === event.target.value)
            if (selected) onChange(selected.val)
          }}
          className="min-h-[52px] w-full appearance-none rounded-[11px] border border-ci-border-2 bg-ci-white px-4 pr-11 text-[15px] font-semibold text-ci-navy outline-none transition-[border-color,box-shadow] focus:border-ci-navy focus:shadow-[0_0_0_3px_var(--ci-blue-50)]"
        >
          {options.map((option) => (
            <option key={option.val} value={option.val}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ci-navy"
        >
          <path
            d="m5 7.5 5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </label>
  )
}

function Seg<T extends string>({ label, value, options, onChange }: SegProps<T>) {
  return (
    <div className="flex items-center gap-[10px]">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ci-gray-500">{label}</span>
      <div className="inline-flex overflow-hidden rounded-[9px] border border-ci-border-2 bg-ci-white">
        {options.map((o) => (
          <button
            key={o.val}
            type="button"
            aria-pressed={value === o.val}
            onClick={() => onChange(o.val)}
            className="min-h-[40px] border-r border-ci-border px-[14px] py-[9px] text-[13.5px] font-semibold text-ci-gray-600 transition-colors last:border-r-0 hover:bg-ci-paper-2 hover:text-ci-navy aria-pressed:bg-ci-navy aria-pressed:text-white"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function MagnifyingGlass() {
  return (
    <svg className="h-[17px] w-[17px] flex-none text-ci-gray-500" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.7" />
      <line x1="12.2" y1="12.2" x2="16" y2="16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
