// Course directory (/courses) — Variant B "continuous blue" reskin.
// Server-rendered header (continuous-blue band) + a thin client child that owns
// the search + filter UI and the reused homepage .ccard grid. Visual reskin
// only: same courses, same filter behaviour. Real course/quiz data throughout.
import Link from 'next/link'
import { courses } from '@/lib/data/courses'
import { quizzes } from '@/lib/data/quizzes'
import type { Course } from '@/lib/types'
import type { CardProps } from '@/components/chrome/Card'
import type { DifficultyLevel } from '@/components/chrome/SignalBar'
import { CourseDirectory, type DirectoryItem } from './CourseDirectory'

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

function buildItems(all: ReadonlyArray<Course>): DirectoryItem[] {
  return all.map((course) => {
    const quiz = quizzes[course.slug]
    const critical = course.examCritical === true
    const cardProps: CardProps = {
      code: course.code,
      title: course.title,
      // Punchy tagline where set; otherwise the real overview (clamped in Card).
      desc: course.tagline ?? course.overview,
      // The amber flag is the lone exam-critical signal; the action pair
      // (primary "View course" + amber "Start quiz") keeps every course
      // reachable, including the critical one.
      flag: critical
        ? { kind: 'critical', label: 'Exam-critical' }
        : { kind: 'tracked', label: 'Tracked' },
      level: String(course.level),
      credits: `${course.credits} credits`,
      questions: quiz ? String(quiz.totalQuestions) : '0',
      timeLimit: quiz ? `${quiz.quizDurationMinutes} min` : '',
      difficulty: toLevel(course.difficulty),
      cta: {
        label: 'View course',
        href: `/courses/${course.slug}`,
        variant: 'primary',
        withArrow: true,
      },
      secondaryCta: critical
        ? {
            label: 'Start quiz',
            href: `/courses/${course.slug}/quiz`,
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

export default function CoursesPage() {
  const items = buildItems(courses)
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
