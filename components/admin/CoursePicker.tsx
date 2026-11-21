// components/admin/CoursePicker.tsx — Searchable catalogue and repository identity selector for operators.
'use client'
import { useState } from 'react'
import type { ReactElement } from 'react'
import type { InstitutionalCourse, RepositoryCourse } from '@/lib/operator/editor-contract'

type Props = {
  repositories: RepositoryCourse[]
  institutional: InstitutionalCourse[]
  selectedCourseId: string | null
  busy: boolean
  onOpen: (courseId: string) => void
  onProvision: (institutional: InstitutionalCourse) => void
}

/** Keep catalogue identity and repository content identity visibly distinct. */
export function CoursePicker({ repositories, institutional, selectedCourseId, busy, onOpen, onProvision }: Props): ReactElement {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const repositoryById = new Map(repositories.map(course => [course.id, course]))
  const matchingInstitutional = institutional.filter(course =>
    `${course.course_code} ${course.display_title} ${repositoryById.get(course.repository_course_id ?? '')?.content_key ?? ''}`
      .toLowerCase().includes(needle))
  const matchingRepositories = repositories.filter(course => course.content_key.toLowerCase().includes(needle))
  const linked = matchingInstitutional.filter(course => course.repository_course_id !== null)
  const unlinked = matchingInstitutional.filter(course => course.repository_course_id === null)

  return (
    <section aria-labelledby="course-picker-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="course-picker-heading" className="text-xl font-semibold text-blue-950">Find a course</h2>
      <p className="mt-1 text-sm text-slate-600">Catalogue courses describe institutional offerings. Repository identities own editable learning content.</p>
      <label htmlFor="operator-course-search" className="mt-5 block text-sm font-medium text-slate-800">Search code, title or content key</label>
      <input id="operator-course-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200" />
      <div className="mt-5 max-h-[36rem] space-y-6 overflow-y-auto pr-1">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Repository content identities · {matchingRepositories.length}</h3>
          <div className="mt-2 space-y-2">{matchingRepositories.map(course => (
            <button key={course.id} type="button" disabled={busy} onClick={() => onOpen(course.id)}
              aria-pressed={selectedCourseId === course.id}
              className="w-full rounded-lg border border-slate-200 p-3 text-left hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:opacity-60 aria-pressed:border-blue-700 aria-pressed:bg-blue-50">
              <span className="block font-medium text-slate-900">{course.content_key}</span>
              <span className="text-xs text-slate-600">{course.is_shared === true ? 'Shared/general content' : course.is_shared === false ? 'Course-specific content' : 'Classification unresolved'}</span>
            </button>
          ))}</div>
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Linked institutional courses · {linked.length}</h3>
          <div className="mt-2 space-y-2">{linked.map(course => (
            <button key={course.id} type="button" disabled={busy} onClick={() => { if (course.repository_course_id) onOpen(course.repository_course_id) }}
              className="w-full rounded-lg border border-slate-200 p-3 text-left hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:opacity-60">
              <span className="block font-medium text-slate-900">{course.course_code} · {course.display_title}</span>
              <span className="text-xs text-slate-600">Linked to {repositoryById.get(course.repository_course_id ?? '')?.content_key ?? 'an unavailable repository identity'}</span>
            </button>
          ))}</div>
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">No repository identity yet · {unlinked.length}</h3>
          <div className="mt-2 space-y-2">{unlinked.map(course => (
            <div key={course.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="font-medium text-slate-900">{course.course_code} · {course.display_title}</p>
              <p className="text-xs text-slate-600">Institutional catalogue only</p>
              <button type="button" disabled={busy} onClick={() => onProvision(course)}
                className="mt-2 rounded-md bg-blue-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 disabled:opacity-60">
                Create repository identity
              </button>
            </div>
          ))}</div>
        </div>
        {matchingRepositories.length + matchingInstitutional.length === 0 && <p className="text-sm text-slate-600">No matching courses.</p>}
      </div>
    </section>
  )
}
