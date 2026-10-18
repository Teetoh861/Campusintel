// app/courses/[slug]/sections.tsx — Study-hub renderers for central Course Detail payloads; no truth derivation here.
import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { STUDY_FAMILIES } from '@/components/student/study-families'
import { theoryDisplayNumbers } from '@/lib/theory-practice/numbering'
import type { StudyFamilyId } from '@/components/student/study-families'
import type { StudentCourseApplicability, StudentCoursePractice, StudentCourseDetailLearning, StudyAvailability }
  from '@/lib/courses/read-model'
import type { ManagedNote, ManagedOverview, ManagedTheoryQuestion } from '@/lib/managed-content/student-projection'
import type { Textbook } from '@/lib/types'
import type { ReactElement, ReactNode } from 'react'

export const COURSE_LEDE = 'Your study hub for this course.'

export type StudySectionId = StudyFamilyId | 'overview' | 'reading'
const STUDY_SECTION_LABELS: Record<StudySectionId, string> = {
  ...Object.fromEntries(STUDY_FAMILIES.map(family => [family.id, family.label])) as Record<StudyFamilyId, string>,
  overview: 'Course overview', reading: 'Reading list',
}

/** Sections in product order: the study families as the shared owner orders them, then context. */
export function studySections({ study, learning, practice, textbooks }: {
  study: StudyAvailability | null
  learning: StudentCourseDetailLearning | null
  practice: StudentCoursePractice | null
  textbooks: number
}): StudySectionId[] {
  const families = study === null ? [] : STUDY_FAMILIES.map(family => family.id).filter(id =>
    study[id] && (id === 'cbtPractice' ? practice !== null : learning !== null))
  return [...families, ...(learning?.overview ? ['overview' as const] : []), ...(textbooks > 0 ? ['reading' as const] : [])]
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** One labelled study section; the kicker carries the same number as the contents rail entry. */
export function StudySection({ id, number, lede, children }: {
  id: StudySectionId; number: number; lede?: string; children: ReactNode
}): ReactElement {
  return <section id={id} aria-labelledby={`${id}-title`} className="student-detail-section">
    <p className="student-detail-kicker" aria-hidden="true">{pad2(number)} / {STUDY_SECTION_LABELS[id]}</p>
    <h2 id={`${id}-title`} className="student-section-title">{STUDY_SECTION_LABELS[id]}</h2>
    {lede && <p className="student-meta">{lede}</p>}
    <div className="student-stack student-detail-stack">{children}</div>
  </section>
}

/** Numbered contents for the study sections that actually exist: chips on small screens, a rail at desktop. */
export function StudyNav({ sections }: { sections: ReadonlyArray<StudySectionId> }): ReactElement | null {
  if (sections.length < 2) return null
  return <nav aria-label="Study sections" className="student-detail-nav">
    <p className="student-detail-kicker student-detail-nav-label">Contents</p>
    <ol>
      {sections.map((id, index) => <li key={id}>
        <a href={`#${id}`} className={studentAction(btnGhost, 'bg-student-surface', 'student-detail-nav-link')}>
          <span className="student-detail-nav-number">{pad2(index + 1)}</span>{STUDY_SECTION_LABELS[id]}
        </a>
      </li>)}
    </ol>
  </nav>
}

/** Render confirmed institutional applicability rows exactly as the catalogue states them. */
export function ApplicabilityList({ applicability }: {
  applicability: ReadonlyArray<StudentCourseApplicability>
}): ReactElement {
  if (applicability.length === 0) return <p className="student-meta">No confirmed department or semester yet.</p>
  return <ul className="student-detail-applicability">
    {applicability.map(row => <li key={`${row.department.id}/${row.academicLevel.id}/${row.academicPeriod.id}`}>
      <span>{row.department.label}</span><span>{row.academicLevel.label}</span><span>{row.academicPeriod.label}</span>
    </li>)}
  </ul>
}

/** The bounded formula rail: text scrolls inside its own card and is never rewritten. */
export function FormulaRail({ formula }: { formula: string }): ReactElement {
  return <div className="student-formula-rail"><code>{formula}</code></div>
}

function Aside({ kicker, children }: { kicker: string; children: ReactNode }): ReactElement {
  return <div className="student-detail-aside">
    <p className="student-detail-kicker">{kicker}</p>
    <p>{children}</p>
  </div>
}

function NoteBody({ note }: { note: ManagedNote }): ReactElement {
  if (!('noteType' in note)) return <p className="student-detail-prose">{note.body}</p>
  if (note.noteType === 'topic_note') return <>
    <p className="student-detail-prose">{note.body}</p>
    <ul className="student-detail-points">{note.keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul>
    {note.examTip !== undefined && <Aside kicker="Exam tip">{note.examTip}</Aside>}
  </>
  return <>
    <p className="student-detail-prose">{note.body}</p>
    {note.formula !== undefined && <FormulaRail formula={note.formula} />}
    <Aside kicker="Example">{note.example}</Aside>
  </>
}

const NOTE_KICKER = { topic_note: 'Topic note', calculator_trick: 'Calculator trick' } as const

/** Validated managed notes in publication order; plain, topic and calculator notes keep their payload verbatim. */
export function NotesSection({ notes, number }: { notes: ReadonlyArray<ManagedNote>; number: number }): ReactElement {
  return <StudySection id="notes" number={number}>
    {notes.map(note => <article key={note.itemId} className="student-surface student-detail-note">
      {'noteType' in note && <p className="student-detail-kicker">{NOTE_KICKER[note.noteType]}</p>}
      <h3>{note.title}</h3>
      <NoteBody note={note} />
    </article>)}
  </StudySection>
}

/** The one Practice entry, from the central usable-quiz summary. */
export function PracticeSection({ practice, number }: { practice: StudentCoursePractice; number: number }): ReactElement {
  return <StudySection id="cbtPractice" number={number} lede="Timed practice sampled from the published question bank.">
    <div className="student-surface student-detail-practice">
      <dl>
        <div><dt>Question bank</dt><dd>{practice.bankSize}</dd></div>
        <div><dt>Per attempt</dt><dd>{practice.attemptSize}</dd></div>
        <div><dt>Time</dt><dd>{practice.timerSeconds / 60} min</dd></div>
      </dl>
      <Link href={practice.href} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>
        Start CBT practice
      </Link>
    </div>
  </StudySection>
}

/** Published prompts plus the self-assessed practice entry when a usable model answer is published.
 * Numbering is shared with Theory practice and preserves authored display numbers.
 */
export function TheorySection({ items, number, practiceHref }: {
  items: ReadonlyArray<ManagedTheoryQuestion>; number: number; practiceHref: string | null
}): ReactElement {
  const labels = theoryDisplayNumbers(items)
  return <StudySection id="theory" number={number} lede="Likely written questions to read and revise.">
    {practiceHref !== null && <div><Link href={practiceHref} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>
      Start theory practice
    </Link></div>}
    <ol className="student-detail-numbered student-surface">
      {items.map((question, index) => <li key={question.itemId}>
        <span>Q{labels[index]}</span>
        <div>
          <p className="student-detail-prose">{question.prompt}</p>
          {question.examTip !== undefined && <Aside kicker="Exam tip">{question.examTip}</Aside>}
        </div>
      </li>)}
    </ol>
  </StudySection>
}

/** Published overview context; every block renders only when the managed payload carries it. */
export function OverviewSection({ overview, number }: { overview: ManagedOverview; number: number }): ReactElement {
  const topics = overview.topics ?? [], examFocus = overview.examFocus ?? []
  const keyTakeaways = overview.keyTakeaways ?? [], formulaSheet = overview.formulaSheet ?? []
  return <StudySection id="overview" number={number} lede="Context from the published course overview.">
    {overview.body.trim() && <p className="student-detail-prose student-reading">{overview.body}</p>}
    {keyTakeaways.length > 0 && <div className="student-detail-group">
      <h3>Key takeaways</h3>
      <ol className="student-detail-numbered student-surface">
        {keyTakeaways.map((item, index) => <li key={index}>
          <span>{pad2(index + 1)}</span>
          <div><p className="student-detail-strong">{item.title}</p><p className="student-detail-prose">{item.description}</p></div>
        </li>)}
      </ol>
    </div>}
    {topics.length > 0 && <div className="student-detail-group">
      <h3>Syllabus topics</h3>
      <ol className="student-detail-numbered student-surface">
        {topics.map((topic, index) => <li key={index}><span>CH {topic.chapter}</span><p className="student-detail-prose">{topic.description}</p></li>)}
      </ol>
    </div>}
    {examFocus.length > 0 && <div className="student-detail-group">
      <h3>Exam focus</h3>
      <ol className="student-detail-numbered student-surface">
        {examFocus.map((line, index) => <li key={index}><span>{pad2(index + 1)}</span><p className="student-detail-strong">{line}</p></li>)}
      </ol>
    </div>}
    {formulaSheet.length > 0 && <div className="student-detail-group">
      <h3>Formula sheet</h3>
      <div className="student-grid">
        {formulaSheet.map((entry, index) => <div key={index} className="student-surface student-detail-item">
          <h4>{entry.name}</h4>
          <FormulaRail formula={entry.formula} />
          <p className="student-detail-prose">{entry.explanation}</p>
          {entry.example !== undefined && <Aside kicker="Example">{entry.example}</Aside>}
        </div>)}
      </div>
    </div>}
  </StudySection>
}

/** Repository-owned textbook metadata; secondary to the study families. */
export function ReadingList({ textbooks, number }: { textbooks: ReadonlyArray<Textbook>; number: number }): ReactElement {
  return <StudySection id="reading" number={number} lede="Textbooks the repository course is built on.">
    <ol className="student-detail-numbered student-surface">
      {textbooks.map((book, index) => <li key={index}>
        <span>{index === 0 ? 'Core' : 'Ref'}</span>
        <div>
          <p className="student-detail-strong">{book.title}</p>
          <p className="student-meta">{book.author}{book.edition ? ` · ${book.edition}` : ''}</p>
        </div>
      </li>)}
    </ol>
  </StudySection>
}
