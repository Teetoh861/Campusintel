// CourseDirectory — the client island for /courses. Owns search query + the
// three segmented filters (level, semester, difficulty) and renders the
// filterbar, results count, course grid and empty state. Card markup itself
// is precomputed on the server (cardProps) so this component stays focused
// on user interaction and bundles light.
'use client'

import { useMemo, useState } from 'react'
import { Card, type CardProps } from '@/components/chrome/Card'
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

  const dsearchClass = trimmed ? 'dsearch has-val' : 'dsearch'
  const fcountClass = isFiltered ? 'fcount filtered' : 'fcount'

  return (
    <>
      <div className="filterbar" data-screen-label="Search and filter">
        <div className="wrap">
          <div className="fb-in">
            <div className={dsearchClass}>
              <MagnifyingGlass />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by code or title — try ACC201"
                aria-label="Search courses by code or title"
                autoComplete="off"
              />
              <button
                type="button"
                className="clearx"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                ×
              </button>
            </div>
            <div className="filters">
              <Seg
                label="Level"
                value={level}
                options={LEVEL_OPTIONS}
                onChange={setLevel}
              />
              <Seg
                label="Semester"
                value={semester}
                options={SEMESTER_OPTIONS}
                onChange={setSemester}
              />
              <Seg
                label="Difficulty"
                value={difficulty}
                options={DIFFICULTY_OPTIONS}
                onChange={setDifficulty}
              />
              <div className={fcountClass}>
                <span className="rc">
                  Showing <b>{filtered.length}</b> of {totalCount}
                </span>
                <button type="button" className="reset" onClick={reset}>
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="dir-grid-sec" data-screen-label="Course grid">
        <div className="wrap">
          {filtered.length > 0 ? (
            <div className="course-grid">
              {filtered.map((item) => (
                <Card key={item.id} {...item.cardProps} />
              ))}
            </div>
          ) : (
            <div className="dir-empty ticks show">
              <div className="de-mark">No file match</div>
              <h3>
                Nothing in the index for{' '}
                <span className="de-q">
                  {trimmed ? `“${trimmed}”` : 'that'}
                </span>
              </h3>
              <p>
                No course matches your search and filters. Clear them to see all{' '}
                {totalCount} files, or check back as coverage expands.
              </p>
              <div className="de-cta">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={reset}
                >
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
    <div className="fgroup">
      <span className="flabel">{label}</span>
      <div className="seg">
        {options.map((o) => (
          <button
            key={o.val}
            type="button"
            aria-pressed={value === o.val}
            onClick={() => onChange(o.val)}
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
    <svg className="mag" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
      <line
        x1="10.8"
        y1="10.8"
        x2="14.5"
        y2="14.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
