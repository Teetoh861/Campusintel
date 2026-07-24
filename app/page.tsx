// Homepage — Variant B ("continuous blue"). Server-rendered. Structure and copy
// follow _design/variant-b-handoff (component-spec.md + the V3 reference), built
// with Tailwind utilities driven by the ci-* tokens. Real course data flows in
// from lib/data/courses.ts; stat figures derive from it where possible.
import Link from 'next/link'
import { courses } from '@/lib/data/courses'
import type { Course } from '@/lib/types'
import { quizzes } from '@/lib/data/quizzes'
import { Card, type CardProps } from '@/components/chrome/Card'
import { HeroMotif } from '@/components/chrome/HeroMotif'
import type { DifficultyLevel } from '@/components/chrome/SignalBar'
import { btnAccent, btnBase, btnGhost, btnGhostOnBlue, btnSm, cx } from '@/components/chrome/ui'

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

const intelIndex = (i: number) => `Intel ${String(i + 1).padStart(2, '0')}`

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

// Hard cap on the curated set the homepage surfaces. Even if more courses are
// flagged featured later, only the first two reach this section; the rest
// belong to /courses.
const HOMEPAGE_FEATURED_COUNT = 2

function cardPropsFor(course: Course, index: number): CardProps {
  const quiz = quizzes[course.slug]
  const critical = course.examCritical === true
  return {
    intelIndex: intelIndex(index),
    code: course.code,
    title: course.title,
    // Punchy homepage tagline under the title (falls back to the full overview
    // for any future featured course without one).
    desc: course.tagline ?? course.overview,
    // The amber flag is the visual signal for exam-critical; the CTA changes
    // alongside it (amber "Start quiz" added) while "View course" stays the
    // primary action on every card so no course is unreachable.
    flag: critical
      ? { kind: 'critical', label: 'Exam-critical' }
      : { kind: 'tracked', label: 'Tracked' },
    level: String(course.level),
    credits: `${course.credits} credits`,
    questions: quiz ? String(quiz.totalQuestions) : '—',
    timeLimit: quiz ? `${quiz.quizDurationMinutes} MIN` : '—',
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
}

function pickFeatured(all: ReadonlyArray<Course>): ReadonlyArray<Course> {
  const flagged = all.filter((c) => c.featured).slice(0, HOMEPAGE_FEATURED_COUNT)
  // Fallback: if nothing is flagged, never render an empty section.
  return flagged.length > 0 ? flagged : all.slice(0, HOMEPAGE_FEATURED_COUNT)
}

export default function HomePage() {
  const courseCount = courses.length
  const textbookCount = courses.reduce((sum, c) => sum + c.textbooks.length, 0)
  const courseCountLabel = String(courseCount).padStart(2, '0')
  // Source order is preserved by pickFeatured; the render order then pulls
  // examCritical to the front so the lone amber moment leads the grid.
  // Array.prototype.sort is stable, so the rest keep their relative order.
  const featured = [...pickFeatured(courses)].sort(
    (a, b) => Number(b.examCritical === true) - Number(a.examCritical === true),
  )

  // The hero product-preview points at one real course: the exam-critical
  // featured course (first flagged). Falls back to the lead featured course so
  // the preview is never empty if the flag is removed entirely.
  const previewCourse = courses.find((c) => c.examCritical === true) ?? featured[0]
  const previewQuiz = previewCourse ? quizzes[previewCourse.slug] : undefined
  // A second, different course peeks out behind the main preview (decorative).
  const behindCourse = featured.find((c) => c.slug !== previewCourse?.slug) ?? courses[1]

  return (
    <>
      {/* ================= HERO ================= */}
      <header className="relative overflow-hidden bg-ci-navy" data-screen-label="Hero">
        <div className={cx(WRAP, 'pb-16 pt-14 min-[900px]:pb-24 min-[900px]:pt-[88px]')}>
          <div className="grid grid-cols-1 items-center gap-[52px] min-[900px]:grid-cols-[1.05fr_.95fr] min-[900px]:gap-16">
            <div>
              <span className="mb-6 inline-flex items-center gap-[10px]">
                <span className="h-[7px] w-[7px] rounded-full bg-ci-accent" />
                <span className="text-[12.5px] font-bold uppercase tracking-[0.16em] text-ci-blue-150">
                  University of Lagos
                </span>
              </span>
              <h1 className="text-balance text-[clamp(43px,8.5vw,76px)] font-extrabold leading-[.99] tracking-[-0.035em] text-white">
                The inside track on{' '}
                <span className="relative whitespace-nowrap">
                  every paper
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-[0.07em] h-[0.13em] rounded-[2px] bg-ci-accent opacity-90"
                  />
                </span>
                .
              </h1>
              <p className="mt-[26px] max-w-[30ch] text-[clamp(18px,2.4vw,21px)] leading-[1.5] text-ci-blue-200">
                Study notes, past questions and exam focus areas, decoded for the courses you&apos;re
                sitting this semester.
              </p>
              <div className="mt-9 flex flex-wrap gap-[13px]">
                <Link className={cx(btnBase, btnAccent)} href="/courses">
                  Browse courses
                </Link>
                <Link className={cx(btnBase, btnGhostOnBlue)} href="/materials">
                  Request materials
                </Link>
              </div>
              <div className="mt-[30px] flex items-center gap-3 text-sm text-ci-blue-200">
                <span className="flex">
                  {['A', 'O', 'E', '+'].map((initial, i) => (
                    <span
                      key={initial}
                      className={cx(
                        'grid h-[30px] w-[30px] place-items-center rounded-full border-2 border-ci-navy bg-ci-blue-600 text-xs font-bold text-white',
                        i > 0 && '-ml-[9px]',
                      )}
                    >
                      {initial}
                    </span>
                  ))}
                </span>
                Trusted by students across the University of Lagos.
              </div>
            </div>

            <div className="relative hidden justify-center min-[900px]:flex">
              <HeroMotif tone="on-blue" />
              {previewCourse ? (
                <HeroPreview
                  code={previewCourse.code}
                  title={previewCourse.title}
                  desc={previewCourse.overview}
                  href={`/courses/${previewCourse.slug}`}
                  level={String(previewCourse.level)}
                  credits={previewCourse.credits}
                  questions={previewQuiz?.totalQuestions}
                  quizMinutes={previewQuiz?.quizDurationMinutes}
                  examCritical={previewCourse.examCritical === true}
                  behindCode={behindCourse?.code}
                  behindTitle={behindCourse?.title}
                />
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {/* ================= FEATURED COURSES ================= */}
      <section className="py-16 min-[900px]:py-[104px]" id="courses" data-screen-label="Featured courses">
        <div className={WRAP}>
          <div className="mb-[42px] flex flex-wrap items-end justify-between gap-6">
            <div>
              <span className="text-[12.5px] font-bold uppercase tracking-[0.16em] text-ci-gray-500">
                Featured files
              </span>
              <h2 className="mt-[14px] max-w-[18ch] text-balance text-[clamp(30px,4.6vw,46px)] font-extrabold leading-[1.02] tracking-[-0.03em] text-ci-navy-900">
                Start with the courses that move your grade.
              </h2>
            </div>
            <Link className={cx(btnBase, btnSm, btnGhost)} href="/courses">
              View all {courseCount} courses
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-5 min-[680px]:grid-cols-2">
            {featured.map((course, i) => (
              <Card key={course.id} {...cardPropsFor(course, i)} />
            ))}
          </div>
        </div>
      </section>

      {/* ================= STATS ================= */}
      <section className="border-y border-ci-border bg-ci-paper-2" aria-label="At a glance">
        <div className={cx(WRAP, 'py-10 min-[900px]:py-12')}>
          {/* Mobile: 2-col grid. >=680px: a flex row with space-between so the
              first stat is flush-left, the last flush-right, and the middle two
              fall on the 1/3 and 2/3 marks with equal gaps between all four. */}
          <div className="grid w-full grid-cols-2 gap-x-5 gap-y-[30px] min-[680px]:flex min-[680px]:justify-between">
            <Stat value={courseCountLabel} label="Courses" />
            <Stat value={String(textbookCount)} label="Textbooks indexed" />
            <Stat value="50" plus label="Questions per course" />
            <Stat value="Peer" label="Tutors coming soon" soon />
          </div>
          <p className="mt-6 border-t border-ci-border pt-5 text-[14.5px] font-medium text-ci-gray-600">
            Now serving <b className="font-bold text-ci-navy-900">Business Administration</b> · 200 Level ·
            First and Second Semester
          </p>
        </div>
      </section>

      {/* ================= PEER TUTORING ================= */}
      <section className="py-12 min-[900px]:py-16" data-screen-label="Peer tutoring">
        <div className={WRAP}>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <h2 className="text-[clamp(26px,4vw,34px)] font-extrabold tracking-[-0.025em] text-ci-navy-900">
              Peer tutoring
            </h2>
            <span className="inline-flex min-h-7 items-center rounded-full border border-ci-blue-200 bg-ci-blue-50 px-3 py-1 text-[11.5px] font-bold uppercase tracking-[0.1em] text-ci-navy">
              Coming soon
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 min-[680px]:grid-cols-2">
            <Link
              href="/tutors"
              className="flex min-h-11 flex-col justify-center rounded-[14px] border border-ci-border bg-ci-white p-5 transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-px hover:border-ci-border-2 hover:shadow-ci-card"
            >
              <h3 className="text-[17px] font-bold text-ci-navy-900">Find a tutor</h3>
              <p className="mt-1 text-[14.5px] leading-[1.5] text-ci-gray-600">
                Join the waitlist for focused course support.
              </p>
            </Link>
            <Link
              href="/become-a-tutor"
              className="flex min-h-11 flex-col justify-center rounded-[14px] border border-ci-border bg-ci-white p-5 transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-px hover:border-ci-border-2 hover:shadow-ci-card"
            >
              <h3 className="text-[17px] font-bold text-ci-navy-900">Become a tutor</h3>
              <p className="mt-1 text-[14.5px] leading-[1.5] text-ci-gray-600">
                Help junior students with courses you know well.
              </p>
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}

// ---- Hero product-preview (.pcard) — a real course, data-driven ----
const PREVIEW_DESC_FALLBACK = 'Double-entry, final accounts and the ratios examiners keep coming back to.'

type HeroPreviewProps = {
  code: string
  title: string
  desc?: string
  href: string
  level: string
  credits: number
  questions?: number
  quizMinutes?: number
  examCritical: boolean
  behindCode?: string
  behindTitle?: string
}

function HeroPreview({
  code,
  title,
  desc,
  href,
  level,
  credits,
  questions,
  quizMinutes,
  examCritical,
  behindCode,
  behindTitle,
}: HeroPreviewProps) {
  return (
    <div className="relative z-[2] w-full max-w-[380px] px-0 pb-[18px] pt-[30px] min-[900px]:max-w-[400px]">
      {/* faded second course card peeking out behind for depth (decorative) */}
      {behindCode && behindTitle ? (
        <div
          aria-hidden
          className="absolute left-1/2 top-[-26px] z-[1] w-[88%] -translate-x-1/2 -rotate-[2.5deg] overflow-hidden rounded-[18px] border border-ci-border bg-ci-white opacity-[0.92] shadow-ci-card"
        >
          <div className="flex items-center justify-between gap-3 px-5 pb-[26px] pt-[13px]">
            <span className="text-[12px] font-bold tracking-[0.08em] text-ci-navy">{behindCode}</span>
            <span className="truncate text-[15px] font-bold text-ci-navy-900">{behindTitle}</span>
          </div>
        </div>
      ) : null}

      <div className="relative z-[2] overflow-hidden rounded-[18px] border border-ci-border bg-ci-white shadow-ci-soft">
        <div className="p-[22px_22px_18px]">
          <div className="flex items-start justify-between gap-[14px]">
            <div>
              <div className="text-[13px] font-bold tracking-[0.08em] text-ci-navy">{code}</div>
              <div className="mt-[7px] text-[21px] font-bold leading-[1.12] tracking-[-0.02em] text-ci-navy-900">
                {title}
              </div>
            </div>
            {examCritical ? (
              <span className="flex-none rounded-[7px] border border-ci-accent-100 bg-ci-accent-50 px-[9px] py-[5px] text-[11px] font-bold uppercase tracking-[0.08em] text-ci-accent-600">
                Exam-critical
              </span>
            ) : null}
          </div>
          <p className="mt-[13px] line-clamp-2 text-[15px] leading-[1.5] text-ci-gray-600">
            {desc ?? PREVIEW_DESC_FALLBACK}
          </p>
        </div>
        <div className="flex items-center gap-4 border-t border-ci-border bg-ci-paper px-[22px] py-[15px]">
          <span className="text-[12.5px] font-medium text-ci-gray-600">
            <b className="font-bold text-ci-navy-900">{level}</b> level
          </span>
          <span className="text-[12.5px] font-medium text-ci-gray-600">
            <b className="font-bold text-ci-navy-900">{credits}</b> credits
          </span>
          {questions ? (
            <span className="text-[12.5px] font-medium text-ci-gray-600">
              <b className="font-bold text-ci-navy-900">{questions}</b> questions
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-between px-[22px] py-4">
          <div className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ci-gray-500">
              {quizMinutes ? 'Timed quiz' : 'Course pack'}
            </span>
            <span className="text-[14px] font-bold text-ci-navy-900">
              {quizMinutes ? `${quizMinutes} min` : 'Notes and past papers'}
            </span>
          </div>
          <Link className={cx(btnBase, btnSm, 'bg-ci-navy text-ci-paper hover:bg-ci-navy-700')} href={href}>
            View course
          </Link>
        </div>
      </div>
    </div>
  )
}

// ---- small composables ----
type StatProps = { value: string; label: string; plus?: boolean; soon?: boolean }

function Stat({ value, label, plus, soon }: StatProps) {
  return (
    <div>
      <div className="text-[clamp(30px,5vw,40px)] font-extrabold leading-none tracking-[-0.02em] text-ci-navy-900 [font-variant-numeric:tabular-nums]">
        {value}
        {plus ? <span className="text-ci-accent-600">+</span> : null}
      </div>
      <div
        className={cx(
          'mt-[10px] text-[13.5px] font-medium text-ci-gray-600',
          soon && "inline-flex items-center gap-[7px] before:h-[5px] before:w-[5px] before:rounded-full before:bg-ci-gray-400 before:content-['']",
        )}
      >
        {label}
      </div>
    </div>
  )
}
