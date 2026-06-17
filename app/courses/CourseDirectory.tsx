// CourseDirectory — Variant B client island for /courses. Owns the search
// query + three segmented filters (level, semester, difficulty) and renders the
// sticky filter bar, result count, reused homepage .ccard grid and empty state.
// Visual reskin only: the filter behaviour is unchanged from the dossier
// version. Card markup is precomputed on the server (cardProps).
'use client'

import { useMemo, useState } from 'react'
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

  const trimmed = query.trim()
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
        className="sticky top-[74px] z-40 border-b border-ci-border bg-ci-paper/[0.92] backdrop-blur-[12px]"
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
            <div className="flex flex-wrap items-center gap-x-[22px] gap-y-[14px] min-[900px]:flex-[2_1_100%]">
              <Seg label="Level" value={level} options={LEVEL_OPTIONS} onChange={setLevel} />
              <Seg label="Semester" value={semester} options={SEMESTER_OPTIONS} onChange={setSemester} />
              <Seg label="Difficulty" value={difficulty} options={DIFFICULTY_OPTIONS} onChange={setDifficulty} />

              <div className="ml-auto flex items-center gap-4">
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
            <div className="grid grid-cols-1 gap-5 min-[680px]:grid-cols-2 min-[900px]:grid-cols-3 min-[900px]:gap-6">
              {filtered.map((item) => (
                <Card key={item.id} {...item.cardProps} />
              ))}
            </div>
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
