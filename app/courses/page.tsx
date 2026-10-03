// Course directory (/courses) — Variant B "continuous blue" reskin.
// Server-rendered header (continuous-blue band) + a thin client child that owns
// the search + filter UI and the reused homepage .ccard grid. Visual reskin
// only: same courses, same filter behaviour. Real course/quiz data throughout.
import Link from 'next/link'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { Feedback } from '@/components/chrome/Feedback'
import { courses } from '@/lib/data/courses'
import { getQuizConfigurationByCourseSlug } from '@/lib/data/quizzes'
import { getPublishedManagedCourse } from '@/lib/managed-content/published'
import { getUsableManagedQuiz } from '@/lib/managed-content/quiz'
import { projectStudentLearning } from '@/lib/managed-content/student-projection'
import type { Course } from '@/lib/types'
import type { CardProps } from '@/components/chrome/Card'
import type { DifficultyLevel } from '@/components/chrome/SignalBar'
import { CourseDirectory, type DirectoryItem } from './CourseDirectory'

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

async function buildItems(all: ReadonlyArray<Course>): Promise<DirectoryItem[] | null> {
  const resolved = await Promise.all(all.map(async course => {
    const published = await getPublishedManagedCourse(course.contentKey)
    if (published.status !== 'ok') return null
    const projected = projectStudentLearning(published.content)
    if (projected.status !== 'ok') return null
    return { course, learning: projected.learning }
  }))
  if (resolved.some(entry => entry === null)) return null
  return resolved.filter((entry): entry is NonNullable<typeof entry> => entry !== null).map(({ course, learning }) => {
    const quiz = getUsableManagedQuiz(course.slug,
      getQuizConfigurationByCourseSlug(course.slug), learning.quizQuestions)
    const critical = course.examCritical === true
    const cardProps: CardProps = {
      code: course.code,
      title: course.title,
      // Punchy tagline where set; otherwise the real overview (clamped in Card).
      desc: course.tagline ?? learning.overview?.body,
      // Exam-critical courses keep their View course action even when a quiz
      // attempt is unavailable.
      flag: critical
        ? { kind: 'critical', label: 'Exam-critical' }
        : { kind: 'tracked', label: 'Tracked' },
      level: String(course.level),
      credits: `${course.credits} credits`,
      questions: quiz ? String(quiz.bankSize) : undefined,
      timeLimit: quiz ? `${quiz.timerSeconds / 60} min` : '',
      difficulty: toLevel(course.difficulty),
      cta: {
        label: 'View course',
        href: `/courses/${course.slug}`,
        variant: 'primary',
        withArrow: true,
      },
      secondaryCta: critical && quiz
        ? {
            label: 'Start quiz',
            href: quiz.href,
            variant: 'secondary',
            withArrow: true,
          }
        : undefined,
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

/** Cross the student account boundary before the course directory renders. */
export default function CoursesPage(): React.JSX.Element {
  return <StudentAccessGate returnPath="/courses"><CourseDirectoryPage /></StudentAccessGate>
}

async function CourseDirectoryPage() {
  const items = await buildItems(courses)
  if (items === null) return <Feedback message="Course content is temporarily unavailable." tone="error" />
  const totalCount = courses.length
  const countLabel = String(totalCount).padStart(2, '0')

  return (
    <>
      {/* ===================== HEADER (continuous blue) ===================== */}
      <header
        className="relative overflow-hidden bg-[linear-gradient(180deg,var(--ci-navy),var(--ci-navy-900))] text-white"
        data-screen-label="Index header"
      >
        <svg
          className="absolute right-[-60px] top-[-50px] z-0 h-[300px] w-[300px] text-ci-blue-600 opacity-50"
          viewBox="0 0 200 200"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="100" cy="100" r="90" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 12" strokeLinecap="round" />
        </svg>
        <div className={`${WRAP} relative z-[1] pb-[42px] pt-[30px] min-[900px]:pb-[52px] min-[900px]:pt-10`}>
          <nav className="mb-[26px] flex flex-wrap items-center gap-[10px] text-[13.5px] font-medium text-ci-blue-200" aria-label="Breadcrumb">
            <Link href="/" className="transition-colors hover:text-white">Home</Link>
            <span className="text-white/35">/</span>
            <span className="text-white">Courses</span>
          </nav>

          <div className="flex flex-wrap items-end justify-between gap-7">
            <div>
              <h1 className="text-[clamp(36px,6.5vw,58px)] font-extrabold leading-none tracking-[-0.035em] text-white">
                Course directory
              </h1>
              <p className="mt-[18px] max-w-[50ch] text-[clamp(16px,2.1vw,19px)] leading-[1.5] text-ci-blue-150">
                Every course we have decoded, in one place. Search a code or title, or filter by level,
                semester and difficulty.
              </p>
            </div>
            <div className="flex flex-none items-baseline gap-[10px]">
              <span className="text-[clamp(46px,8vw,68px)] font-extrabold leading-[0.9] tracking-[-0.02em] text-ci-accent [font-variant-numeric:tabular-nums]">
                {countLabel}
              </span>
              <span className="text-[14px] font-semibold tracking-[0.04em] text-ci-blue-200">courses</span>
            </div>
          </div>

          <p className="mt-[26px] inline-flex items-start gap-[9px] text-[13.5px] font-medium tracking-[0.02em] text-ci-blue-200">
            <span className="mt-[7px] h-[6px] w-[6px] flex-none rounded-full bg-ci-accent" />
            Now serving Business Administration · 200 Level · First and Second Semester
          </p>
        </div>
      </header>

      <CourseDirectory items={items} totalCount={totalCount} />
    </>
  )
}
