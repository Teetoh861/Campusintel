// Course detail (/courses/[slug]) — Variant B "continuous blue" reskin.
// Server-rendered. Section order and conditional rendering are unchanged from
// the dossier version; section index numbers (01, 02, ...) are computed from
// the visible subset so an omitted section leaves no gap. Visual reskin only:
// continuous-blue cover, warm off-white body with a sticky ToC rail, white-on-
// warm cards, and a navy closing quiz CTA. Real course/quiz data throughout.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { courses, getCourseBySlug } from '@/lib/data/courses'
import { getQuizByCourseSlug } from '@/lib/data/quizzes'
import {
  getTheoryContentBySlug,
  type TheoryQuestion,
} from '@/lib/data/theory-questions'
import type {
  Course,
  Topic,
  Textbook,
  KeyTakeaway,
  Resource,
  FormulaEntry,
} from '@/lib/types'
import { SignalBar, type DifficultyLevel } from '@/components/chrome/SignalBar'
import { btnAccent, btnBase, btnNavy, btnSm, cx } from '@/components/chrome/ui'
import { BookmarkButton } from './BookmarkButton'
import { CourseToc, type TocItem } from './CourseToc'
import { MobileCourseNav } from './MobileCourseNav'

type PageProps = { params: Promise<{ slug: string }> }

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

export function generateStaticParams() {
  return courses.map((c) => ({ slug: c.slug }))
}

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

const semesterLabel = (n: number) =>
  n === 1 ? 'First' : n === 2 ? 'Second' : String(n)

// Section descriptors — each appears only when its data is present. Numbers are
// assigned at render time from the visible subset.
type SectionId =
  | 'overview'
  | 'takeaways'
  | 'topics'
  | 'exam'
  | 'formulas'
  | 'textbooks'
  | 'theory'
  | 'resources'

type SectionDescriptor = {
  id: SectionId
  tocLabel: string
  headLabel: string
}

const SECTION_ORDER: ReadonlyArray<SectionDescriptor> = [
  { id: 'overview', tocLabel: 'Overview', headLabel: 'Overview' },
  { id: 'takeaways', tocLabel: 'Key takeaways', headLabel: 'Key takeaways' },
  { id: 'topics', tocLabel: 'Topics', headLabel: 'Topics' },
  { id: 'exam', tocLabel: 'Exam focus', headLabel: 'Exam focus' },
  { id: 'formulas', tocLabel: 'Formula sheet', headLabel: 'Formula sheet' },
  { id: 'textbooks', tocLabel: 'Textbooks', headLabel: 'Recommended textbooks' },
  { id: 'theory', tocLabel: 'Theory questions', headLabel: 'Theory questions' },
  { id: 'resources', tocLabel: 'Resources', headLabel: 'Resources' },
]

const pad2 = (n: number) => String(n).padStart(2, '0')

export default async function CourseDetailPage({ params }: PageProps) {
  const { slug } = await params
  const course = getCourseBySlug(slug)
  if (!course) notFound()
  const quiz = getQuizByCourseSlug(slug)
  const theory = getTheoryContentBySlug(slug)

  const takeaways = course.keyTakeaways ?? []
  const theoryQuestions = theory?.theoryQuestions ?? []
  const formulaSheet = course.formulaSheet ?? []

  const visible: ReadonlyArray<SectionDescriptor> = SECTION_ORDER.filter((s) => {
    if (s.id === 'overview') return Boolean(course.overview)
    if (s.id === 'takeaways') return takeaways.length > 0
    if (s.id === 'topics') return course.topics.length > 0
    if (s.id === 'exam') return course.examFocus.length > 0
    if (s.id === 'formulas') return formulaSheet.length > 0
    if (s.id === 'textbooks') return course.textbooks.length > 0
    if (s.id === 'theory') return theoryQuestions.length > 0
    if (s.id === 'resources') return true // resources renders its empty-state when none
    return false
  })

  const sectionNumber = (id: SectionId) => {
    const i = visible.findIndex((s) => s.id === id)
    return i >= 0 ? pad2(i + 1) : ''
  }
  const isVisible = (id: SectionId) => visible.some((s) => s.id === id)

  const tocItems: ReadonlyArray<TocItem> = visible.map((s, i) => ({
    id: s.id,
    label: s.tocLabel,
    num: pad2(i + 1),
  }))

  const quizHref = `/courses/${course.slug}/quiz`
  const materialsHref = `/courses/${course.slug}/materials`
  const questionsValue = quiz ? String(quiz.totalQuestions) : 'N/A'
  const quizTimeValue = quiz ? `${quiz.quizDurationMinutes} min` : 'N/A'

  // Closing-band kicker, built from real values: "ACC201 · 150 questions · 30 minutes".
  const closingKicker = [
    course.code,
    quiz ? `${quiz.totalQuestions} questions` : null,
    quiz ? `${quiz.quizDurationMinutes} minutes` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      {/* ===================== COVER (continuous blue) ===================== */}
      <header
        className="relative overflow-hidden bg-[linear-gradient(180deg,var(--ci-navy),var(--ci-navy-900))] text-white"
        data-screen-label="Cover"
      >
        <DashedRing className="absolute right-[-60px] top-[-40px] z-0 h-[300px] w-[300px] text-ci-blue-600 opacity-50" />
        <div className={cx(WRAP, 'relative z-[1] pb-11 pt-[30px] min-[900px]:pb-[60px] min-[900px]:pt-10')}>
          <nav className="mb-[30px] flex flex-wrap items-center gap-[10px] text-[13.5px] font-medium text-ci-blue-200" aria-label="Breadcrumb">
            <Link href="/" className="transition-colors hover:text-white">Home</Link>
            <span className="text-white/35">/</span>
            <Link href="/courses" className="transition-colors hover:text-white">Courses</Link>
            <span className="text-white/35">/</span>
            <span className="text-white">{course.title}</span>
          </nav>

          <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-ci-accent">{course.code}</div>
          <h1 className="mt-3 text-balance text-[clamp(38px,7vw,64px)] font-extrabold leading-none tracking-[-0.035em] text-white">
            {course.title}
          </h1>
          <p className="mt-5 max-w-[54ch] text-[clamp(17px,2.2vw,20px)] leading-[1.5] text-ci-blue-150">
            {course.overview}
          </p>

          <div className="mt-[30px] flex flex-wrap gap-[13px]">
            <Link className={cx(btnBase, btnAccent)} href={quizHref}>
              Start quiz
            </Link>
            <BookmarkButton slug={course.slug} variant="cover" />
          </div>

          <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-white/[0.14] bg-white/[0.14] min-[680px]:grid-cols-3 min-[900px]:grid-cols-6">
            <Meta k="Level" v={String(course.level)} />
            <Meta k="Semester" v={semesterLabel(course.semester)} />
            <Meta k="Credits" v={`${course.credits} CR`} />
            <Meta k="Difficulty">
              <SignalBar level={toLevel(course.difficulty)} tone="on-blue" />
              {course.difficulty}
            </Meta>
            <Meta k="Questions" v={questionsValue} />
            <Meta k="Quiz time" v={quizTimeValue} />
          </div>
        </div>
      </header>

      {/* ===================== BODY: rail + main ===================== */}
      <div className="pt-14 min-[900px]:pt-[72px]">
        <MobileCourseNav
          items={tocItems}
          materialsHref={materialsHref}
          quizHref={quiz ? quizHref : undefined}
        />
        <div className={WRAP}>
          <div className="grid grid-cols-1 gap-10 min-[900px]:grid-cols-[230px_1fr] min-[900px]:items-start min-[900px]:gap-[60px]">
            <CourseToc items={tocItems} quizHref={quizHref} />

            <div className="flex min-w-0 flex-col gap-16 min-[900px]:gap-[88px]">
              {isVisible('overview') ? (
                <Section id="overview" num={sectionNumber('overview')} kicker="Overview" h2="The paper, decoded">
                  <Prose>
                    <p>{course.overview}</p>
                  </Prose>
                </Section>
              ) : null}

              {isVisible('takeaways') ? (
                <Section id="takeaways" num={sectionNumber('takeaways')} kicker="Key takeaways" h2="Core principles">
                  <Takeaways items={takeaways} />
                </Section>
              ) : null}

              {isVisible('topics') ? (
                <Section id="topics" num={sectionNumber('topics')} kicker="Topics" h2="Syllabus contents">
                  <Topics items={course.topics} />
                </Section>
              ) : null}

              {isVisible('exam') ? (
                // The one amber moment of the body lives inside the exam-focus
                // panel; the section header stays monochrome.
                <section id="exam" className="scroll-mt-[96px]" data-screen-label="Exam focus">
                  <SectionHead num={sectionNumber('exam')} kicker="Exam focus" />
                  <div className="rounded-[20px] border border-ci-accent-100 bg-[linear-gradient(180deg,var(--ci-accent-50),var(--ci-white)_42%)] p-[30px_26px] shadow-ci-card">
                    <span className="inline-flex items-center gap-[9px] rounded-full border border-ci-accent-100 bg-ci-white px-[13px] py-[6px] text-[12px] font-bold uppercase tracking-[0.12em] text-ci-accent-600">
                      <span className="h-[6px] w-[6px] rounded-full bg-ci-accent" />
                      Exam intelligence
                    </span>
                    <h2 className="mt-[18px] text-[clamp(22px,3.4vw,28px)] font-extrabold tracking-[-0.025em] text-ci-navy-900">
                      What the exam actually tests
                    </h2>
                    <p className="mt-3 max-w-[60ch] text-[16px] leading-[1.55] text-ci-gray-600">
                      High-yield areas pulled from past papers. If your time is short, study these first.
                    </p>
                    <ExamFocus items={course.examFocus} />
                  </div>
                </section>
              ) : null}

              {isVisible('formulas') ? (
                <Section id="formulas" num={sectionNumber('formulas')} kicker="Formula sheet" h2="Formulas & worked examples">
                  <FormulaSheet items={formulaSheet} />
                </Section>
              ) : null}

              {isVisible('textbooks') ? (
                <Section id="textbooks" num={sectionNumber('textbooks')} kicker="Recommended textbooks" h2="The reading">
                  <Textbooks items={course.textbooks} />
                </Section>
              ) : null}

              {isVisible('theory') ? (
                <Section id="theory" num={sectionNumber('theory')} kicker="Theory questions" h2="Likely written questions">
                  <TheoryList items={theoryQuestions} />
                </Section>
              ) : null}

              {isVisible('resources') ? (
                <Section id="resources" num={sectionNumber('resources')} kicker="Resources" h2="Files to download">
                  <Resources items={course.resources} slug={course.slug} />
                </Section>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* ===================== CLOSING QUIZ CTA ===================== */}
      <section className="pb-20 pt-16" id="quiz" data-screen-label="Quiz entry">
        <div className={WRAP}>
          <div className="relative overflow-hidden rounded-[24px] bg-ci-navy p-[48px_26px] text-center text-white min-[900px]:p-[72px_40px]">
            <DashedRing className="absolute left-1/2 top-1/2 h-[340px] w-[340px] -translate-x-1/2 -translate-y-1/2 text-ci-blue-600 opacity-45" />
            <div className="relative z-[1] flex flex-col items-center">
              <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-ci-accent">{closingKicker}</span>
              <h2 className="mt-[14px] text-[clamp(30px,5vw,48px)] font-extrabold leading-none tracking-[-0.03em] text-white">
                Sit the mock.
              </h2>
              <p className="mt-4 max-w-[46ch] text-[17px] leading-[1.55] text-ci-blue-200">
                Run the full question bank under exam conditions. You will know exactly where you stand before the hall does.
              </p>
              <div className="mt-[30px] flex flex-wrap justify-center gap-[13px]">
                <Link className={cx(btnBase, btnAccent)} href={quizHref}>
                  Start quiz
                </Link>
                <BookmarkButton slug={course.slug} variant="closing" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

// ---- section scaffolding ----
function SectionHead({ num, kicker }: { num: string; kicker: string }) {
  return (
    <div className="mb-[18px] flex items-center gap-[9px] text-[12.5px] font-bold uppercase tracking-[0.14em] text-ci-gray-500">
      <span className="text-ci-accent-600">{num} /</span> {kicker}
    </div>
  )
}

type SectionProps = {
  id: SectionId
  num: string
  kicker: string
  h2: string
  children: React.ReactNode
}

function Section({ id, num, kicker, h2, children }: SectionProps) {
  return (
    <section id={id} className="scroll-mt-[96px]" data-screen-label={kicker}>
      <SectionHead num={num} kicker={kicker} />
      <h2 className="text-[clamp(26px,4vw,34px)] font-extrabold leading-[1.05] tracking-[-0.03em] text-ci-navy-900">
        {h2}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="[&>p]:mt-4 [&>p]:max-w-[64ch] [&>p]:text-[17px] [&>p]:leading-[1.65] [&>p]:text-ci-gray-600 [&>p:first-child]:mt-0">
      {children}
    </div>
  )
}

function Meta({ k, v, children }: { k: string; v?: string; children?: React.ReactNode }) {
  return (
    <div className="bg-ci-navy p-[16px_18px]">
      <div className="text-[11px] font-bold uppercase tracking-[0.13em] text-ci-blue-200">{k}</div>
      <div className="mt-2 flex items-center gap-[9px] text-[17px] font-bold text-white">{children ?? v}</div>
    </div>
  )
}

function Takeaways({ items }: { items: ReadonlyArray<KeyTakeaway> }) {
  return (
    <ol className="grid grid-cols-1 gap-[14px]">
      {items.map((t, i) => (
        <li
          key={i}
          className="flex gap-[18px] rounded-[16px] border border-ci-border bg-ci-white p-[22px_24px] shadow-ci-card"
        >
          <span className="flex-none pt-[3px] text-[13px] font-bold tracking-[0.06em] text-ci-accent-600">{pad2(i + 1)}</span>
          <div className="min-w-0">
            <h3 className="text-[18px] font-bold tracking-[-0.015em] text-ci-navy-900">{t.title}</h3>
            <p className="mt-[7px] text-[15px] leading-[1.55] text-ci-gray-600">{t.description}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Topics({ items }: { items: ReadonlyArray<Topic> }) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-ci-border bg-ci-white shadow-ci-card">
      {items.map((t, i) => (
        <div
          key={i}
          className="grid grid-cols-[auto_1fr] items-baseline gap-3 border-b border-ci-border p-[16px_22px] last:border-b-0 min-[640px]:grid-cols-[88px_1fr] min-[640px]:gap-[18px]"
        >
          <span className="whitespace-nowrap text-[12px] font-bold uppercase tracking-[0.06em] text-ci-navy">CH {t.chapter}</span>
          <span className="text-[15.5px] leading-[1.5] text-ci-gray-700">{t.description}</span>
        </div>
      ))}
    </div>
  )
}

function ExamFocus({ items }: { items: ReadonlyArray<string> }) {
  return (
    <ol className="mt-6 grid grid-cols-1 gap-4">
      {items.map((line, i) => (
        <li key={i} className="flex gap-4">
          <span className="flex-none pt-[2px] text-[13px] font-bold text-ci-accent-600">/{pad2(i + 1)}</span>
          <h3 className="text-[17px] font-bold tracking-[-0.01em] text-ci-navy-900">{line}</h3>
        </li>
      ))}
    </ol>
  )
}

function Textbooks({ items }: { items: ReadonlyArray<Textbook> }) {
  return (
    <div className="grid grid-cols-1 gap-[14px]">
      {items.map((b, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-[14px] border border-ci-border bg-ci-white p-[20px_22px] shadow-ci-card min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between min-[640px]:gap-4"
        >
          <div className="min-w-0">
            <h3 className="text-[17px] font-bold tracking-[-0.01em] text-ci-navy-900">{b.title}</h3>
            <div className="mt-[6px] text-[13.5px] text-ci-gray-500">
              {b.author}
              {b.edition ? (
                <>
                  {' '}<span className="mx-1 text-ci-gray-400">·</span> {b.edition}
                </>
              ) : null}
            </div>
          </div>
          {/* First entry is the core text per the comp; the rest are references.
              self-start keeps the tag hugging the left when stacked on mobile. */}
          <span className="flex-none self-start rounded-[7px] border border-ci-blue-100 bg-ci-blue-50 px-[10px] py-[5px] text-[11px] font-bold uppercase tracking-[0.08em] text-ci-navy min-[640px]:self-auto">
            {i === 0 ? 'Core text' : 'Reference'}
          </span>
        </div>
      ))}
    </div>
  )
}

// Formula sheet — one card per formula. The formula string is kept as clean
// Unicode text (σ, μ, Σ, √, ±, ≤, ≥, superscripts — no LaTeX) and rides in an
// overflow-x-auto rail so a long formula scrolls inside its own card rather
// than forcing the page to scroll on mobile.
function FormulaSheet({ items }: { items: ReadonlyArray<FormulaEntry> }) {
  return (
    <div className="grid grid-cols-1 gap-[14px] min-[720px]:grid-cols-2">
      {items.map((f, i) => (
        <div
          key={i}
          className="flex flex-col rounded-[16px] border border-ci-border bg-ci-white p-[22px_24px] shadow-ci-card"
        >
          <h3 className="text-[17px] font-bold tracking-[-0.015em] text-ci-navy-900">{f.name}</h3>
          <div className="mt-3 overflow-x-auto rounded-[10px] border border-ci-blue-100 bg-ci-blue-50 px-[14px] py-[12px]">
            <code className="block whitespace-nowrap font-mono text-[15px] font-semibold leading-[1.5] text-ci-navy">
              {f.formula}
            </code>
          </div>
          <p className="mt-3 text-[14.5px] leading-[1.55] text-ci-gray-600">{f.explanation}</p>
          {f.example ? (
            <div className="mt-[14px] border-t border-ci-border pt-[12px]">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ci-accent-600">Example</div>
              <p className="mt-[6px] text-[14px] leading-[1.55] text-ci-gray-700">{f.example}</p>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function TheoryList({ items }: { items: ReadonlyArray<TheoryQuestion> }) {
  return (
    <ol className="grid grid-cols-1 gap-3">
      {items.map((q) => (
        <li
          key={q.id}
          className="flex gap-4 rounded-[14px] border border-ci-border bg-ci-white p-[18px_22px] shadow-ci-card"
        >
          <span className="flex-none pt-[2px] text-[13px] font-bold tracking-[0.04em] text-ci-accent-600">Q{q.id}</span>
          <p className="text-[15.5px] leading-[1.55] text-ci-gray-700">{q.question}</p>
        </li>
      ))}
    </ol>
  )
}

function Resources({ items, slug }: { items: ReadonlyArray<Resource>; slug: string }) {
  const materialsHref = `/courses/${slug}/materials`
  return (
    <>
      {items.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-ci-border-2 bg-ci-paper-2 p-[40px_24px] text-center">
          <div className="text-[17px] font-bold text-ci-navy-900">No materials yet</div>
          <p className="mx-auto mt-2 max-w-[42ch] text-[14.5px] text-ci-gray-600">
            Lecture notes, past questions and worked examples will appear here as coverage expands. Check back soon.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {items.map((r) => (
            // Mobile: two stacked rows — [tag + full-width title] then
            // [size · Request]. At >=640px the inner groups become `contents`
            // so tag/title/size/action collapse into one horizontal flex row.
            <Link
              key={r.id}
              href={materialsHref}
              className="flex flex-col gap-3 rounded-[14px] border border-ci-border bg-ci-white p-[18px_22px] shadow-ci-card transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-[2px] hover:border-ci-border-2 hover:shadow-ci-soft min-[640px]:flex-row min-[640px]:items-center min-[640px]:gap-4"
            >
              <div className="flex flex-col gap-2 min-[640px]:contents">
                <span className="flex-none self-start rounded-[7px] bg-ci-blue-50 px-[9px] py-[6px] text-[12px] font-bold tracking-[0.04em] text-ci-navy min-[640px]:self-auto">
                  {resourceTag(r.type)}
                </span>
                <span className="min-w-0 text-[15.5px] font-semibold text-ci-navy-900 min-[640px]:flex-1">{r.title}</span>
              </div>
              <div className="flex items-center justify-between gap-4 min-[640px]:contents">
                <span className="text-[13px] font-medium text-ci-gray-500">{r.fileSize ?? ''}</span>
                <span className="whitespace-nowrap text-[14px] font-semibold text-ci-navy">Request</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-[18px] flex flex-wrap items-center justify-between gap-4 border-t border-ci-border pt-[18px]">
        <span className="text-[14px] text-ci-gray-600">Have notes or past questions for this course?</span>
        <Link className={cx(btnBase, btnSm, btnNavy)} href={materialsHref}>
          Request or share materials
        </Link>
      </div>
    </>
  )
}

function resourceTag(type: Resource['type']) {
  if (type === 'pdf') return 'PDF'
  if (type === 'past-question') return 'PQ'
  if (type === 'notes') return 'NOTES'
  return 'LINK'
}

function DashedRing({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <circle cx="100" cy="100" r="90" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 12" strokeLinecap="round" />
    </svg>
  )
}
