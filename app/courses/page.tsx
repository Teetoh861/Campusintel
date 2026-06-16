// Course directory (/courses) — server-rendered shell. Renders the dossier
// header from _design/courses.html and hands the courses to a thin client
// child that owns the search + filter UI. The directory stylesheet is scoped
// to this route segment so other pages don't pay for it.
import Link from 'next/link'
import '../../styles/directory.css'
import { courses } from '@/lib/data/courses'
import { quizzes } from '@/lib/data/quizzes'
import type { Course } from '@/lib/types'
import { HeroMotif } from '@/components/chrome/HeroMotif'
import type { CardProps } from '@/components/chrome/Card'
import type { DifficultyLevel } from '@/components/chrome/SignalBar'
import { CourseDirectory, type DirectoryItem } from './CourseDirectory'

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

const fileIndex = (i: number) => `File ${String(i + 1).padStart(2, '0')}`

function buildItems(all: ReadonlyArray<Course>): DirectoryItem[] {
  return all.map((course, i) => {
    const quiz = quizzes[course.slug]
    const critical = course.examCritical === true
    const cardProps: CardProps = {
      intelIndex: fileIndex(i),
      code: course.code,
      title: course.title,
      flag: critical
        ? { kind: 'critical', label: 'Exam-critical' }
        : { kind: 'tracked', label: 'Tracked' },
      level: String(course.level),
      credits: `${course.credits} CR`,
      questions: quiz ? String(quiz.totalQuestions) : '—',
      timeLimit: quiz ? `${quiz.quizDurationMinutes} MIN` : '—',
      difficulty: toLevel(course.difficulty),
      cta: critical
        ? {
            label: 'Start quiz',
            href: `/courses/${course.slug}/quiz`,
            variant: 'primary',
            withArrow: true,
          }
        : {
            label: 'View course',
            href: `/courses/${course.slug}`,
            variant: 'secondary',
          },
    }
    return {
      id: course.id,
      cardProps,
      filter: {
        code: course.code,
        title: course.title,
        level: course.level,
        semester: course.semester,
        difficulty: course.difficulty,
      },
    }
  })
}

export default function CoursesPage() {
  const items = buildItems(courses)
  const totalCount = courses.length
  const countLabel = String(totalCount).padStart(2, '0')

  return (
    <>
      <header className="course-cover" data-screen-label="Index header">
        <HeroMotif />
        <div className="wrap">
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span className="sep">/</span>
            <span className="cur">Courses</span>
          </nav>

          <div className="dir-count">
            <span className="num">{countLabel}</span>
            <span className="lab">Files</span>
          </div>
          <h1 className="dir-title">The Index</h1>
          <p className="dir-lede">
            Every intelligence file in one place. Search a code or title, narrow
            by level, semester or difficulty, and open the dossier.
          </p>
          <p className="coverage">
            <span className="cov-k">Now covering</span>
            {' '}<span className="cov-sep">·</span>{' '}Business Administration
            {' '}<span className="cov-sep">·</span>{' '}200 Level
            {' '}<span className="cov-sep">·</span>{' '}First Semester
          </p>
        </div>
      </header>

      <CourseDirectory items={items} totalCount={totalCount} />
    </>
  )
}
