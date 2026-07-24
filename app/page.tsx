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
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import { btnAccent, btnBase, btnGhost, btnGhostOnBlue, btnLight, btnSm, cx } from '@/components/chrome/ui'

const WHATSAPP_URL = buildWhatsAppUrl('Hello, I need help with CampusIntel')

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

const intelIndex = (i: number) => `Intel ${String(i + 1).padStart(2, '0')}`

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

// Hard cap on the curated set the homepage surfaces. Even if more courses are
// flagged featured later, only the first three reach this section; the rest
// belong to /courses.
const HOMEPAGE_FEATURED_COUNT = 3

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
                <a
                  className={cx(btnBase, btnGhostOnBlue)}
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Message on WhatsApp
                </a>
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

            <div className="relative flex justify-center">
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

      {/* ================= STATS ================= */}
      <section className="border-b border-ci-border bg-ci-paper-2" aria-label="At a glance">
        <div className={cx(WRAP, 'py-[34px]')}>
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

      {/* ================= FEATURED COURSES ================= */}
      <section className="py-[72px] min-[900px]:py-[104px]" id="courses" data-screen-label="Featured courses">
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

          <div className="grid grid-cols-1 gap-5 min-[680px]:grid-cols-3">
            {featured.map((course, i) => (
              <Card key={course.id} {...cardPropsFor(course, i)} />
            ))}
          </div>
        </div>
      </section>

      {/* ================= WHAT YOU GET ================= */}
      <section
        className="border-y border-ci-border bg-ci-paper-2 py-[72px] min-[900px]:py-[104px]"
        id="features"
        data-screen-label="What you get"
      >
        <div className={WRAP}>
          <div className="mb-[42px] flex flex-col gap-4">
            <span className="text-[12.5px] font-bold uppercase tracking-[0.16em] text-ci-gray-500">
              What you get
            </span>
            <h2 className="max-w-[18ch] text-balance text-[clamp(30px,4.6vw,46px)] font-extrabold leading-[1.02] tracking-[-0.03em] text-ci-navy-900">
              Everything you need to walk in prepared.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-[14px] min-[680px]:grid-cols-3">
            <Feature
              title="Study notes and calculator tips"
              body="Decoded summaries topic by topic, with the calculator shortcuts that save you minutes in the hall."
              icon={<NotesIcon />}
            />
            <Feature
              title="Timed practice quizzes"
              body="50+ questions per course under real exam pressure, so the clock never catches you off guard."
              icon={<TimerIcon />}
            />
            <Feature
              title="Exam focus areas"
              body="The topics that actually recur, ranked from years of past papers, so you study what the exam rewards."
              icon={<TargetIcon />}
            />
          </div>
        </div>
      </section>

      {/* ================= PEER TUTORING ================= */}
      <section className="py-[72px] min-[900px]:py-[104px]" id="tutoring" data-screen-label="Peer tutoring">
        <div className={WRAP}>
          <div className="overflow-hidden rounded-[24px] border border-ci-border bg-ci-paper-2">
            <div className="p-[40px_28px] min-[900px]:p-[56px_52px]">
              <div className="min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:items-center min-[900px]:gap-12">
                <div>
                  <div className="mb-[14px] flex flex-wrap items-center gap-[14px]">
                    <span className="text-[12.5px] font-bold uppercase tracking-[0.16em] text-ci-gray-500">
                      Peer tutoring
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-ci-blue-200 bg-ci-blue-50 px-[15px] py-[7px] text-[12.5px] font-bold uppercase tracking-[0.12em] text-ci-navy">
                      <span className="h-[6px] w-[6px] rounded-full bg-ci-navy" />
                      Coming soon
                    </span>
                  </div>
                  <h2 className="max-w-[20ch] text-[clamp(27px,4vw,38px)] font-extrabold leading-[1.05] tracking-[-0.03em] text-ci-navy-900">
                    A real person for the parts that don&apos;t click.
                  </h2>
                  <p className="mt-[14px] max-w-[54ch] text-[17px] leading-[1.55] text-ci-gray-600">
                    Pair with a senior who has already aced the paper, or share what you know with juniors.
                    Rolling out next semester.
                  </p>
                </div>

                <div className="mt-[30px] grid grid-cols-1 gap-[14px] min-[680px]:grid-cols-2 min-[900px]:mt-0">
                  <PathCard
                    title="Find a tutor"
                    body="Book focused sessions on the exam-critical topics."
                    linkLabel="Join the waitlist"
                    href="/tutors"
                    icon={<PersonIcon />}
                  />
                  <PathCard
                    title="Become a tutor"
                    body="300L and above can help juniors and earn for sessions."
                    linkLabel="Apply to tutor"
                    href="/become-a-tutor"
                    icon={<StarIcon />}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= CLOSING CTA ================= */}
      <section className="relative overflow-hidden bg-ci-navy text-ci-paper" id="contact" data-screen-label="Closing CTA">
        <svg
          className="absolute right-[-40px] top-[-30px] z-[1] h-[280px] w-[280px] text-ci-blue-600 opacity-50"
          viewBox="0 0 200 200"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="100" cy="100" r="90" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 12" strokeLinecap="round" />
        </svg>
        <div className={cx(WRAP, 'relative z-[2] py-[72px] min-[900px]:py-[104px]')}>
          <div className="flex flex-col items-start min-[900px]:items-center min-[900px]:text-center">
            <span className="text-[12.5px] font-bold uppercase tracking-[0.16em] text-ci-accent">
              University of Lagos
            </span>
            <h2 className="mt-[18px] max-w-[16ch] text-balance text-[clamp(34px,6vw,60px)] font-extrabold leading-none tracking-[-0.035em] text-white">
              Walk in already knowing.
            </h2>
            <p className="mt-5 max-w-[44ch] text-[18px] leading-[1.55] text-ci-blue-200">
              Every course, every past question, every exam focus area in one place.
            </p>
            <div className="mt-[34px] flex flex-wrap gap-[13px]">
              <Link className={cx(btnBase, btnAccent)} href="/courses">
                Start studying
              </Link>
              <a className={cx(btnBase, btnLight)} href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                Message on WhatsApp
              </a>
            </div>
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

function Feature({ title, body, icon }: { title: string; body: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-transparent p-[30px_26px] transition-[background-color,border-color] duration-200 hover:border-ci-border hover:bg-ci-white">
      <span className="block h-[46px] w-[46px] text-ci-navy">{icon}</span>
      <h3 className="mt-[22px] text-[20px] font-bold tracking-[-0.018em] text-ci-navy-900">{title}</h3>
      <p className="mt-[10px] text-[15.5px] leading-[1.55] text-ci-gray-600">{body}</p>
    </div>
  )
}

function PathCard({
  title,
  body,
  linkLabel,
  href,
  icon,
}: {
  title: string
  body: string
  linkLabel: string
  href: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-[14px] border border-ci-border bg-ci-white p-6">
      {/* flex-1 keeps the two links on a shared baseline regardless of copy */}
      <div className="flex flex-[1_0_auto] flex-col gap-2">
        <span className="mb-2 block h-[34px] w-[34px] text-ci-navy">{icon}</span>
        <h4 className="text-[18px] font-bold tracking-[-0.015em] text-ci-navy-900">{title}</h4>
        <p className="text-[14.5px] leading-[1.5] text-ci-gray-600">{body}</p>
      </div>
      <Link
        href={href}
        className="group mt-0 inline-flex items-center gap-[7px] whitespace-nowrap pt-[14px] text-[14.5px] font-semibold text-ci-navy transition-[gap] duration-150 hover:gap-[11px]"
      >
        {linkLabel}
      </Link>
    </div>
  )
}

// ---- feature / path icons (line-art, currentColor + amber accents) ----
function NotesIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" className="h-full w-full">
      <rect x="9" y="7" width="22" height="30" rx="3.5" stroke="currentColor" strokeWidth="2.2" />
      <line x1="14.5" y1="14" x2="25.5" y2="14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="14.5" y1="19.5" x2="25.5" y2="19.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="14.5" y1="25" x2="21" y2="25" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="28" y="24" width="13" height="17" rx="3" fill="#F4F1EA" stroke="currentColor" strokeWidth="2.2" />
      <line x1="31" y1="29.5" x2="38" y2="29.5" stroke="#E0A33E" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="32" cy="34.5" r="1.2" fill="currentColor" />
      <circle cx="37" cy="34.5" r="1.2" fill="currentColor" />
    </svg>
  )
}

function TimerIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" className="h-full w-full">
      <circle cx="24" cy="26" r="15" stroke="currentColor" strokeWidth="2.2" />
      <path d="M24 17.5V26l5.5 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="19" y1="6.5" x2="29" y2="6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="24" y1="6.5" x2="24" y2="11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M37 14l2.5-2.5" stroke="#E0A33E" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function TargetIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" className="h-full w-full">
      <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="24" cy="24" r="8.5" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="24" cy="24" r="2.4" fill="#E0A33E" />
      <line x1="24" y1="2.5" x2="24" y2="9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="24" y1="39" x2="24" y2="45.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 34 34" fill="none" className="h-full w-full">
      <circle cx="17" cy="11" r="6" stroke="currentColor" strokeWidth="2.1" />
      <path d="M6 29c0-6 5-9.5 11-9.5S28 23 28 29" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg viewBox="0 0 34 34" fill="none" className="h-full w-full">
      <path
        d="M17 4l3.7 7.5 8.3 1.2-6 5.8 1.4 8.2L17 24l-7.4 3.9 1.4-8.2-6-5.8 8.3-1.2L17 4z"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}
