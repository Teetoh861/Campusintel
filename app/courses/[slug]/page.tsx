// Course detail (/courses/[slug]) — server-rendered dossier. Section order
// and structure follow _design/course.html exactly; the section index
// numbers (01, 02, …) are computed dynamically so any section omitted for
// lack of data leaves no gap in the sequence.
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
} from '@/lib/types'
import { HeroMotif } from '@/components/chrome/HeroMotif'
import { SignalBar, type DifficultyLevel } from '@/components/chrome/SignalBar'
import { BookmarkButton } from './BookmarkButton'

type PageProps = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return courses.map((c) => ({ slug: c.slug }))
}

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

const semesterLabel = (n: number) =>
  n === 1 ? 'First' : n === 2 ? 'Second' : String(n)

// Section descriptors — each appears in the page only when its data is
// present. Numbers are assigned at render time from the visible subset, so
// e.g. a course with no key takeaways has Overview = 01, Topics = 02, ….
type SectionId =
  | 'overview'
  | 'takeaways'
  | 'topics'
  | 'exam'
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

  // Build the list of sections that will actually render. Drives both the
  // TOC and the per-section "01 / Overview" headers.
  const visible: ReadonlyArray<SectionDescriptor> = SECTION_ORDER.filter((s) => {
    if (s.id === 'overview') return Boolean(course.overview)
    if (s.id === 'takeaways') return takeaways.length > 0
    if (s.id === 'topics') return course.topics.length > 0
    if (s.id === 'exam') return course.examFocus.length > 0
    if (s.id === 'textbooks') return course.textbooks.length > 0
    if (s.id === 'theory') return theoryQuestions.length > 0
    if (s.id === 'resources') return true // resources renders empty-state when none
    return false
  })

  const sectionNumber = (id: SectionId) => {
    const i = visible.findIndex((s) => s.id === id)
    return i >= 0 ? pad2(i + 1) : ''
  }
  const isVisible = (id: SectionId) => visible.some((s) => s.id === id)

  const quizHref = `/courses/${course.slug}/quiz`

  return (
    <>
      <header className="course-cover" data-screen-label="Cover">
        <HeroMotif />
        <div className="wrap">
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/courses">Courses</Link>
            <span className="sep">/</span>
            <span className="cur">{course.code}</span>
          </nav>

          <div className="cover-code">{course.code}</div>
          <h1 className="cover-title">{course.title}</h1>
          <p className="cover-desc">{course.overview}</p>

          <div className="cover-cta">
            <Link className="btn btn-primary" href={quizHref}>
              Start quiz <span className="arrow">&rarr;</span>
            </Link>
            <BookmarkButton slug={course.slug} />
          </div>

          <div className="cover-meta">
            <Meta k="Level" v={String(course.level)} />
            <Meta k="Semester" v={semesterLabel(course.semester)} />
            <Meta k="Credits" v={`${course.credits} CR`} />
            <div className="cmeta">
              <div className="k">Difficulty</div>
              <div className="v">
                <SignalBar level={toLevel(course.difficulty)} />
                {' '}
                {course.difficulty}
              </div>
            </div>
            <Meta k="Questions" v={quiz ? String(quiz.totalQuestions) : '—'} />
            <Meta
              k="Time limit"
              v={quiz ? `${quiz.quizDurationMinutes} MIN` : '—'}
            />
          </div>
        </div>
      </header>

      <div className="cbody">
        <div className="wrap">
          <div className="cbody-grid">
            <aside className="crail" aria-label="On this page">
              <div className="rail-label">Contents</div>
              <nav className="toc">
                {visible.map((s, i) => (
                  <Link key={s.id} href={`#${s.id}`}>
                    <span className="tn">{pad2(i + 1)}</span> {s.tocLabel}
                  </Link>
                ))}
              </nav>
              <Link className="btn btn-primary" href={quizHref}>
                Start quiz <span className="arrow">&rarr;</span>
              </Link>
            </aside>

            <div className="cmain">
              {isVisible('overview') ? (
                <Section
                  id="overview"
                  num={sectionNumber('overview')}
                  kicker="Overview"
                  h2="The paper, decoded"
                >
                  <div className="dsec-body">
                    <p>{course.overview}</p>
                  </div>
                </Section>
              ) : null}

              {isVisible('takeaways') ? (
                <Section
                  id="takeaways"
                  num={sectionNumber('takeaways')}
                  kicker="Key takeaways"
                  h2="Core principles"
                >
                  <Takeaways items={takeaways} />
                </Section>
              ) : null}

              {isVisible('topics') ? (
                <Section
                  id="topics"
                  num={sectionNumber('topics')}
                  kicker="Topics"
                  h2="Syllabus contents"
                >
                  <Topics items={course.topics} />
                </Section>
              ) : null}

              {isVisible('exam') ? (
                // The one teal moment on this page lives inside the exam-focus
                // block. The section header itself stays monochrome — the
                // .examfocus container provides the signal treatment.
                <section
                  className="dsec"
                  id="exam"
                  data-screen-label="Exam focus"
                >
                  <div className="dsec-head">
                    <div className="sk">
                      <span className="n">{sectionNumber('exam')} /</span> Exam focus
                    </div>
                  </div>
                  <div className="examfocus">
                    <span className="signal">
                      <span className="sdot" />
                      The signal · exam intelligence
                    </span>
                    <h2 className="ef-h2">What the exam actually tests</h2>
                    <p className="ef-lead">
                      High-yield areas pulled from past papers. If your time is
                      short, study these first.
                    </p>
                    <ExamFocus items={course.examFocus} />
                  </div>
                </section>
              ) : null}

              {isVisible('textbooks') ? (
                <Section
                  id="textbooks"
                  num={sectionNumber('textbooks')}
                  kicker="Recommended textbooks"
                  h2="The reading"
                >
                  <Textbooks items={course.textbooks} />
                </Section>
              ) : null}

              {isVisible('theory') ? (
                <Section
                  id="theory"
                  num={sectionNumber('theory')}
                  kicker="Theory questions"
                  h2="Likely written questions"
                >
                  <TheoryList items={theoryQuestions} />
                </Section>
              ) : null}

              {isVisible('resources') ? (
                <Section
                  id="resources"
                  num={sectionNumber('resources')}
                  kicker="Resources"
                  h2="Files to download"
                >
                  <Resources items={course.resources} />
                </Section>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <section className="sec" id="quiz" data-screen-label="Quiz entry">
        <div className="wrap">
          <div className="closing">
            <ClosingMotif />
            <div className="cl-inner">
              <span className="cl-kicker">
                {course.code}
                {quiz ? ` · ${quiz.totalQuestions} questions` : null}
                {quiz ? ` · ${quiz.quizDurationMinutes} minutes` : null}
              </span>
              <h2>Sit the mock.</h2>
              <p>
                Run the full question bank under exam conditions. You will know
                exactly where you stand before the hall does.
              </p>
              <div className="cl-cta">
                <Link className="btn btn-primary" href={quizHref}>
                  Start quiz <span className="arrow">&rarr;</span>
                </Link>
                <BookmarkButton slug={course.slug} />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
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
    <section className="dsec" id={id} data-screen-label={kicker}>
      <div className="dsec-head">
        <div className="sk">
          <span className="n">{num} /</span> {kicker}
        </div>
      </div>
      <h2 className="dsec-h2">{h2}</h2>
      {children}
    </section>
  )
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="cmeta">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  )
}

function Takeaways({ items }: { items: ReadonlyArray<KeyTakeaway> }) {
  return (
    <ol className="takeaways">
      {items.map((t, i) => (
        <li key={i}>
          <span className="tk-n">{pad2(i + 1)}</span>
          <div>
            <h3>{t.title}</h3>
            <p>{t.description}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Topics({ items }: { items: ReadonlyArray<Topic> }) {
  return (
    <div className="topics">
      {items.map((t, i) => (
        <div key={i} className="trow">
          <span className="tch">CH {t.chapter}</span>
          <span className="td">{t.description}</span>
        </div>
      ))}
    </div>
  )
}

function ExamFocus({ items }: { items: ReadonlyArray<string> }) {
  return (
    <ol className="focus-list">
      {items.map((line, i) => (
        <li key={i}>
          <span className="fl-n">/{pad2(i + 1)}</span>
          <div>
            <h3>{line}</h3>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Textbooks({ items }: { items: ReadonlyArray<Textbook> }) {
  return (
    <div className="books">
      {items.map((b, i) => (
        <div key={i} className="book">
          <div className="bk-main">
            <h3>{b.title}</h3>
            <div className="bk-meta">
              {b.author}
              {b.edition ? (
                <>
                  {' '}<span className="sep">·</span> {b.edition}
                </>
              ) : null}
            </div>
          </div>
          {/* First entry is marked Core text per the comp; rest are References */}
          <span className="bk-tag">{i === 0 ? 'Core text' : 'Reference'}</span>
        </div>
      ))}
    </div>
  )
}

function TheoryList({ items }: { items: ReadonlyArray<TheoryQuestion> }) {
  return (
    <ol className="theory">
      {items.map((q) => (
        <li key={q.id}>
          <span className="q-n">Q{q.id}</span>
          <p>{q.question}</p>
        </li>
      ))}
    </ol>
  )
}

function Resources({ items }: { items: ReadonlyArray<Resource> }) {
  if (items.length === 0) {
    return (
      <div className="res-empty ticks">
        <div className="re-label">No files yet</div>
        <p>
          Lecture notes, past questions and worked examples will appear here as
          coverage expands. Check back soon.
        </p>
      </div>
    )
  }
  return (
    <div className="resources">
      {items.map((r) => (
        <a
          key={r.id}
          className="res"
          href={r.url ?? '#'}
          {...(r.url
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          <span className="res-ic">[ {resourceTag(r.type)} ]</span>
          <span className="res-name">{r.title}</span>
          {r.fileSize ? <span className="res-size">{r.fileSize}</span> : null}
          <span className="res-dl">Download ↓</span>
        </a>
      ))}
    </div>
  )
}

function resourceTag(type: Resource['type']) {
  if (type === 'pdf') return 'PDF'
  if (type === 'past-question') return 'PQ'
  if (type === 'notes') return 'NOTES'
  return 'LINK'
}

function ClosingMotif() {
  return (
    <svg className="cl-motif" viewBox="0 0 100 100" aria-hidden="true">
      <path
        d="M 76.2 68.35 A 32 32 0 1 1 76.2 31.65"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="84.5" cy="50" r="3.1" fill="currentColor" />
    </svg>
  )
}
