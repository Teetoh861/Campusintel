// components/dashboard/PrimaryCards.tsx — The student's semester courses (owner's sprint plan of 23 Oct, item 2: open or
// locked, with progress once practised) and the complete Practice proposition.
import Link from 'next/link'
import { CBrandTexture } from '@/components/student/CBrandTexture'
import { StatusRail } from '@/components/student/StatusRail'
import { EMPTY_COURSES_MESSAGE } from '@/components/student/course-copy'
import { studentFocusControl, studentFocusDark } from '@/components/student/ui'
import { isAiPracticeAvailable } from '@/lib/ai-practice/config'
import { formatCourseProgress } from '@/lib/dashboard/home-courses'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { HomeCourse, HomeCourseStatus, HomeCourses } from '@/lib/dashboard/home-courses'
import type { ReactElement } from 'react'

const STATUS_LABELS: Record<HomeCourseStatus, string> = {
  open: 'Open', locked: 'Locked', missing: 'No materials yet', temporary: 'Unavailable right now',
}

function CourseItem({ course }: { course: HomeCourse }): ReactElement {
  const body = <>
    <span className="dashboard-course-heading">
      <span className="dashboard-course-code">{course.code}</span>
      <span className="dashboard-course-status" data-status={course.status}>{STATUS_LABELS[course.status]}</span>
    </span>
    <span className="dashboard-course-title">{course.title}</span>
    {course.progress !== null && <span className="dashboard-course-progress">{formatCourseProgress(course.progress)}</span>}
  </>
  return <li>{course.href === null
    ? <div className="dashboard-course-item">{body}</div>
    : <Link href={course.href} prefetch={false} className={`dashboard-course-item ${studentFocusDark}`}>{body}</Link>}
  </li>
}

/** The semester's courses, or a neutral line when they cannot be read or none are listed. */
function CourseList({ home }: { home: HomeCourses | null }): ReactElement {
  if (home === null) return <p className="dashboard-primary-copy">Course information is temporarily unavailable.</p>
  if (home.courses.length === 0) return <p className="dashboard-primary-copy">{EMPTY_COURSES_MESSAGE}</p>
  return <ul className="dashboard-course-list">{home.courses.map(course => <CourseItem key={course.id} course={course} />)}</ul>
}

/** Two primary surfaces: the semester's courses and current/future personal practice. */
export function PrimaryCards({ home }: { home: HomeCourses | null }): ReactElement {
  const aiAvailable = isAiPracticeAvailable()
  return <section aria-label="Study and practice" className="dashboard-primary-grid">
    <section aria-labelledby="my-courses-title" className="dashboard-course-file student-enter student-enter-1">
      <span className="dashboard-file-tab">This semester</span>
      <div className="dashboard-file-body">
        <CBrandTexture />
        <div className="dashboard-file-content">
          <h2 id="my-courses-title">Your courses</h2>
          <CourseList home={home} />
          {/* An empty list has nothing to view: My Courses would open empty. */}
          {(home === null || home.courses.length > 0) && <Link href={STUDENT_DESTINATIONS.myCourses.href} prefetch={false}
            className={`dashboard-primary-action ${studentFocusControl}`}>View my courses</Link>}
        </div>
      </div>
    </section>
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
          <h3 id="upload-practice-title">Practise from your notes</h3>
          {!aiAvailable && <StatusRail status="unavailable">Currently unavailable</StatusRail>}
        </div>
        <p>{aiAvailable
          ? 'With AI access on your account, upload notes for courses without CampusIntell study materials. AI questions are for personal study and are not verified by CampusIntell.'
          : 'Personal AI practice from your own notes is currently unavailable. AI questions are not verified by CampusIntell.'}</p>
      </section>
      <Link href={STUDENT_DESTINATIONS.myCourses.href} prefetch={false}
        className={`dashboard-practice-action ${studentFocusControl}`}>
        Choose a course
      </Link>
    </article>
  </section>
}
