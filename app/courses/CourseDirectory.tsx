// Client presentation controls over institutional identity and server-rendered course results.
'use client'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { btnGhost } from '@/components/chrome/ui'
import { CourseRegister } from '@/components/student/CourseRow'
import { EmptyState } from '@/components/student/EmptyState'
import { SearchField } from '@/components/student/SearchField'
import { FilterSelect } from '@/components/student/FilterSelect'
import { Pagination } from '@/components/student/Pagination'
import { studentAction, studentFocusControl } from '@/components/student/ui'
import { COURSES_PER_PAGE } from './catalogue-presentation'
import type { FilterOption } from '@/components/student/FilterSelect'
import type { DirectoryItem } from './catalogue-presentation'
import type { StudentCourseApplicability } from '@/lib/courses/read-model'

type Filters = { department: string | null; academicLevel: string | null; academicPeriod: string | null }
const ALL_FILTERS: Filters = { department: null, academicLevel: null, academicPeriod: null }
const labelOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function optionsFor(items: ReadonlyArray<DirectoryItem>, dimension: keyof Filters): FilterOption[] {
  const references = new Map<string, FilterOption>()
  for (const item of items) for (const tuple of item.applicability) {
    const reference = tuple[dimension]
    references.set(reference.id, { id: reference.id, label: reference.label })
  }
  return [...references.values()].sort((a, b) =>
    labelOrder.compare(a.label, b.label) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function matchesTuple(tuple: StudentCourseApplicability, filters: Filters): boolean {
  return (filters.department === null || tuple.department.id === filters.department) &&
    (filters.academicLevel === null || tuple.academicLevel.id === filters.academicLevel) &&
    (filters.academicPeriod === null || tuple.academicPeriod.id === filters.academicPeriod)
}

/** Search and filter the full institutional set before paging its already-rendered results. */
export function CourseDirectory({ items }: { items: ReadonlyArray<DirectoryItem> }) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(ALL_FILTERS)
  const [requestedPage, setPage] = useState(1)
  const searchRef = useRef<HTMLInputElement>(null)
  const departmentRef = useRef<HTMLSelectElement>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const hasFilters = Object.values(filters).some(value => value !== null)
  const options = useMemo(() => ({
    department: optionsFor(items, 'department'),
    academicLevel: optionsFor(items, 'academicLevel'),
    academicPeriod: optionsFor(items, 'academicPeriod'),
  }), [items])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return items.filter(item =>
      (!term || item.code.toLowerCase().includes(term) || item.title.toLowerCase().includes(term)) &&
      (!hasFilters || item.applicability.some(tuple => matchesTuple(tuple, filters))))
  }, [items, query, filters, hasFilters])
  const totalPages = Math.ceil(filtered.length / COURSES_PER_PAGE)
  const page = Math.min(requestedPage, Math.max(1, totalPages))
  // Clamp before slicing as well as settling state, so data shrink never flashes an empty page.
  useEffect(() => { if (requestedPage !== page) setPage(page) }, [page, requestedPage])
  const visible = filtered.slice((page - 1) * COURSES_PER_PAGE, page * COURSES_PER_PAGE)
  const changeQuery = (value: string) => { setQuery(value); setPage(1) }
  const changeFilter = (dimension: keyof Filters, value: string | null) => {
    setFilters(current => ({ ...current, [dimension]: value })); setPage(1)
  }
  const resetAll = () => { setQuery(''); setFilters(ALL_FILTERS); setPage(1); searchRef.current?.focus() }

  if (items.length === 0) return <EmptyState title="No institutional courses available yet." actions={null}>
    The institutional catalogue is empty. Please check back later.
  </EmptyState>

  return <>
    <section className="student-catalogue-controls" aria-label="Search and filter courses">
      <div className="student-catalogue-search">
        <SearchField id="course-search" label="Search courses by code or title"
          placeholder="Course code or title" value={query} onChange={changeQuery} inputRef={searchRef} />
      </div>
      <div className="student-catalogue-filter-fields">
        <FilterSelect id="course-department" label="Department" value={filters.department}
          options={options.department} onChange={value => changeFilter('department', value)} selectRef={departmentRef} />
        <FilterSelect id="course-level" label="Level" value={filters.academicLevel}
          options={options.academicLevel} onChange={value => changeFilter('academicLevel', value)} />
        <FilterSelect id="course-semester" label="Semester" value={filters.academicPeriod}
          options={options.academicPeriod} onChange={value => changeFilter('academicPeriod', value)} />
      </div>
    </section>
    <div className="student-catalogue-summary">
      <p className="student-summary" role="status" aria-live="polite" aria-atomic="true">
        {filtered.length} {filtered.length === 1 ? 'result' : 'results'} of {items.length} courses
      </p>
      <button type="button" disabled={!hasFilters} className={studentAction(btnGhost)}
        onClick={() => { setFilters(ALL_FILTERS); setPage(1); departmentRef.current?.focus() }}>Clear filters</button>
    </div>
    <section ref={resultsRef} tabIndex={-1} aria-labelledby="course-results-title"
      className={'student-catalogue-results ' + studentFocusControl}>
      <h2 id="course-results-title" className="sr-only">Institutional course results</h2>
      {filtered.length > 0
        ? <CourseRegister label="Institutional courses">
          {visible.map(item => <Fragment key={item.institutionalCourseId}>{item.row}</Fragment>)}
        </CourseRegister>
        : <EmptyState title="No courses match your search and filters." actions={
          <button type="button" onClick={resetAll} className={studentAction(btnGhost)}>Reset search and filters</button>
        }>Try another course code or title, or reset your search and filters.</EmptyState>}
    </section>
    <Pagination page={page} totalPages={totalPages} onPageChange={setPage}
      label="Course catalogue pages" scrollTarget={resultsRef} />
  </>
}
