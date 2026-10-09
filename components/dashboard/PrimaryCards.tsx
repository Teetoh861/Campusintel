// components/dashboard/PrimaryCards.tsx — Course-file navigation and the complete Practice proposition.
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { CBrandTexture } from '@/components/student/CBrandTexture'
import { StatusRail } from '@/components/student/StatusRail'
import { studentFocusCard, studentFocusControl } from '@/components/student/ui'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { DashboardCourse } from '@/lib/dashboard/current-student-courses'
import type { ReactElement } from 'react'

function courseSummary(courses: ReadonlyArray<DashboardCourse> | null): string {
  if (courses === null) return 'Course information is temporarily unavailable.'
  if (courses.length === 0) return 'No confirmed courses for this selection yet.'
  const total = `${courses.length} ${courses.length === 1 ? 'course' : 'courses'}`
  const ready = courses.filter(course => course.content.state === 'ready').length
  return `${total} · ${ready > 0 ? `${ready} ready to study` : 'Study content coming gradually'}`
}

/** Two primary surfaces: current semester study and current/future personal practice. */
export function PrimaryCards({ courses }: { courses: ReadonlyArray<DashboardCourse> | null }): ReactElement {
  return <section aria-label="Study and practice" className="dashboard-primary-grid">
    <Link href={STUDENT_DESTINATIONS.myCourses.href} prefetch={false}
      className={`dashboard-course-file student-interactive-card student-enter student-enter-1 ${studentFocusCard}`}>
      <span className="dashboard-file-tab">{courseSummary(courses)}</span>
      <div className="dashboard-file-body">
        <CBrandTexture />
        <div className="dashboard-file-content">
          <h2>{STUDENT_DESTINATIONS.myCourses.label}</h2>
          <p className="dashboard-primary-copy">Your semester, in one place.</p>
          <div className="dashboard-file-index" aria-hidden="true">
            {['Overview', 'Notes', 'Theory', 'CBT practice'].map((label, index) =>
              <span key={label}><span>{String(index + 1).padStart(2, '0')}</span>{label}</span>)}
          </div>
          <p className="dashboard-file-note">Published resources vary by course.</p>
          <span className="dashboard-primary-action">View my courses <ArrowRight aria-hidden="true" size={18} /></span>
        </div>
      </div>
    </Link>
    <article aria-labelledby="practice-title" className="dashboard-practice student-enter student-enter-2">
      <p className="dashboard-practice-eyebrow">Verified CBT practice</p>
      <div className="dashboard-practice-heading">
        <h2 id="practice-title">Practice</h2>
        <div className="dashboard-answer-sheet" aria-hidden="true">
          {['A', 'B', 'C', 'D'].map(letter => <span key={letter}>{letter}</span>)}
        </div>
      </div>
      <div className="dashboard-cbt">
        <p>Choose a course to practise.</p>
      </div>
      <section aria-labelledby="upload-practice-title" className="dashboard-upload">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="upload-practice-title">Upload to Practice</h3>
          <StatusRail>Coming soon</StatusRail>
        </div>
        <p>Turn your own material into personal AI-assisted practice. Not verified by CampusIntell.</p>
      </section>
      <Link href={STUDENT_DESTINATIONS.myCourses.href} prefetch={false}
        className={`dashboard-practice-action ${studentFocusControl}`}>
        Choose a course <ArrowRight aria-hidden="true" size={18} />
      </Link>
    </article>
  </section>
}
