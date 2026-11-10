// app/courses/[slug]/sections.tsx — Study-hub renderers for central Course Detail payloads; no truth derivation here.
import Link from 'next/link'
import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { STUDY_FAMILIES } from '@/components/student/study-families'
import { theoryDisplayNumbers } from '@/lib/theory-practice/numbering'
import { GuideTopicBody } from './guide'
import type { GuideLinks } from './guide'
import type { StudyFamilyId } from '@/components/student/study-families'
import type { StudentCourseApplicability, StudentCoursePractice, StudentCourseDetailLearning, StudyAvailability }
  from '@/lib/courses/read-model'
import type { ManagedNote, ManagedOverview, ManagedTheoryQuestion } from '@/lib/managed-content/student-projection'
import type { PracticeTopicRow } from '@/lib/practice/topics'
import type { Textbook } from '@/lib/types'
import type { ReactElement, ReactNode } from 'react'

export const COURSE_LEDE = 'Your study hub for this course.'

export type StudySectionId = StudyFamilyId | 'overview' | 'reading'
const STUDY_SECTION_LABELS: Record<StudySectionId, string> = {
  ...Object.fromEntries(STUDY_FAMILIES.map(family => [family.id, family.label])) as Record<StudyFamilyId, string>,
  overview: 'Course overview', reading: 'Reading list',
}

/** Sections in product order: the study families as the shared owner orders them, then context. */
export function studySections({ study, learning, practice, textbooks, bankTopics = 0 }: {
  study: StudyAvailability | null
  learning: StudentCourseDetailLearning | null
  practice: StudentCoursePractice | null
  textbooks: number
  // A course whose questions come from an official bank has an overview of its bank topics even with no stored one.
  bankTopics?: number
}): StudySectionId[] {
  const families = study === null ? [] : STUDY_FAMILIES.map(family => family.id).filter(id =>
    study[id] && (id === 'cbtPractice' ? practice !== null : learning !== null))
  return [...families, ...(learning?.overview || bankTopics > 0 ? ['overview' as const] : []),
    ...(textbooks > 0 ? ['reading' as const] : [])]
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
  if (applicability.length === 0) return <p className="student-meta">Check your course requirements. The department and semester for this material have not been confirmed.</p>
  return <ul className="student-detail-applicability">
    {applicability.map(row => <li key={`${row.department.id}/${row.academicLevel.id}/${row.academicPeriod.id}`}>
      <span>{row.department.label}</span><span>{row.academicLevel.label}</span><span>{row.academicPeriod.label}</span>
    </li>)}
  </ul>
}

const FORMULA_OPENERS = '([{', FORMULA_CLOSERS = ')]}'
/** A bracketed group this long or shorter, such as "(P − v)" or "(FC + Target Profit)", never breaks inside. Lengths
 *  are visible characters: "x̄" is one. Every formula box holds about 28 on a line (375 px, and the two-column desktop
 *  formula sheet). */
const SHORT_GROUP = 20
/** A closing term shorter than this joins the term before it, so "× 100" never sits alone on a line. */
const SHORT_TAIL = 8
/** No joined unit is longer than this, so each still fits a formula box's continuation line. */
const LONGEST_UNIT = 24
const FORMULA_OPERATOR = /^[=+−\-×÷/±]$/

/** The formula as units that never break inside, each with the separator before it: a space (a line may break there)
 *  or nothing (a line may break between two adjacent groups, as in "x̄)(y"). Joined, the units are the formula. */
export function formulaUnits(formula: string): Array<{ before: ' ' | ''; text: string }> {
  const width = (text: string) => text.replace(/\p{M}/gu, '').length
  const groups: Array<[number, number]> = []
  const open: number[] = []
  for (let index = 0; index < formula.length; index++) {
    if (FORMULA_OPENERS.includes(formula[index])) open.push(index)
    else if (FORMULA_CLOSERS.includes(formula[index]) && open.length > 0) groups.push([open.pop()!, index])
  }
  const short = groups.filter(([start, end]) => width(formula.slice(start, end + 1)) <= SHORT_GROUP)
  const units: Array<{ before: ' ' | ''; text: string }> = []
  let start = 0, before: ' ' | '' = ''
  for (let index = 0; index <= formula.length; index++) {
    const space = formula[index] === ' ' && !short.some(([from, to]) => from < index && index < to)
    const between = index > 0 && FORMULA_CLOSERS.includes(formula[index - 1]) && FORMULA_OPENERS.includes(formula[index] ?? '')
      && !short.some(([from, to]) => from <= index - 1 && index <= to)
    if (index === formula.length || space || between) {
      units.push({ before, text: formula.slice(start, index) })
      before = space ? ' ' : ''
      start = space ? index + 1 : index
    }
  }
  const join = (index: number) => units.splice(index, 2,
    { before: units[index].before, text: units[index].text + units[index + 1].before + units[index + 1].text })
  // A second space in a row keeps its text, joined to the unit after it.
  for (let index = units.length - 2; index >= 0; index--) if (units[index].text === '') join(index)
  const fits = (index: number) => width(units[index].text) + width(units[index + 1].text) + 1 <= LONGEST_UNIT
  while (units.length > 1 && width(units[units.length - 1].text) < SHORT_TAIL && fits(units.length - 2)) join(units.length - 2)
  // An operator starts the line it is on, with the term after it, never ending the line before.
  for (let index = units.length - 2; index >= 0; index--) {
    if (FORMULA_OPERATOR.test(units[index].text) && units[index + 1].before === ' ' && fits(index)) join(index)
  }
  // An opening bracket stays with the term inside it.
  for (let index = units.length - 2; index >= 0; index--) {
    if (FORMULA_OPENERS.includes(units[index].text.at(-1) ?? '') && units[index + 1].before === ' ' && fits(index)) join(index)
  }
  return units
}

/** The formula rail: the text is never rewritten. A long formula wraps only between its units (see formulaUnits). */
export function FormulaRail({ formula }: { formula: string }): ReactElement {
  return <div className="student-formula-rail"><code>{formulaUnits(formula).map((unit, index) => <Fragment key={index}>
    {unit.before === ' ' ? ' ' : index > 0 && <wbr />}<span className="student-formula-word">{unit.text}</span>
  </Fragment>)}</code></div>
}

function Aside({ kicker, children }: { kicker: string; children: ReactNode }): ReactElement {
  return <div className="student-detail-aside">
    <p className="student-detail-kicker">{kicker}</p>
    <p>{children}</p>
  </div>
}

/** A note's body. A guide topic renders its lessons, recap and theory question; `links` adds its theory and practice
 * buttons, and `level` sets its heading level (2 on its own page, 4 inside a note card). */
export function NoteBody({ note, links, level = 4 }: { note: ManagedNote; links?: GuideLinks; level?: 2 | 4 }): ReactElement {
  if (!('noteType' in note)) return <p className="student-detail-prose">{note.body}</p>
  if (note.noteType === 'guide_topic') return <GuideTopicBody topic={note} links={links} level={level} />
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

export const NOTE_KICKER = { topic_note: 'Topic note', calculator_trick: 'Calculator trick', guide_topic: 'Study guide' } as const

/** One published note, rendered the same wherever a student may read it. */
export function NoteArticle({ note }: { note: ManagedNote }): ReactElement {
  return <article className="student-surface student-detail-note" data-note-item={note.itemId}>
    {'noteType' in note && <p className="student-detail-kicker">{NOTE_KICKER[note.noteType]}</p>}
    <h3>{note.title}</h3>
    <NoteBody note={note} />
  </article>
}

/** Notes on the course page: one compact card that opens the topic list. Each topic is read on its own page. */
export function NotesCard({ notes, href, number }: {
  notes: ReadonlyArray<ManagedNote>; href: string; number: number
}): ReactElement {
  return <StudySection id="notes" number={number}>
    <Link href={href} prefetch={false} className="student-topic-row student-focus-control">
      <span className="student-topic-text"><b>Open notes</b><span>{notes.length === 1 ? '1 topic' : `${notes.length} topics`}</span></span>
      <ChevronRight aria-hidden="true" size={20} strokeWidth={2} className="student-topic-go" />
    </Link>
  </StudySection>
}

/** Practice: the course's topics in order (each starts instant feedback on its questions), then Exam mode. A course
 * without topics offers Exam mode only. */
export function PracticeSection({ practice, topics, number }: {
  practice: StudentCoursePractice; topics: ReadonlyArray<PracticeTopicRow>; number: number
}): ReactElement {
  const hasTopics = topics.length > 0
  return <StudySection id="cbtPractice" number={number}
    lede={hasTopics ? 'Pick a topic. Each answer is marked as you go.' : 'Timed multiple-choice questions, marked at the end.'}>
    {hasTopics && <ol className="student-topic-list" aria-label="Topics">
      {topics.map(row => <li key={row.topic}>
        <Link href={`${practice.href}?topic=${encodeURIComponent(row.topic)}`} prefetch={false}
          className="student-topic-row student-focus-control">
          <span className="student-topic-number" aria-hidden="true">{row.number}</span>
          <span className="student-topic-text"><b>{row.topic}</b><span>{row.line}</span></span>
          <ChevronRight aria-hidden="true" size={20} strokeWidth={2} className="student-topic-go" />
        </Link>
      </li>)}
    </ol>}
    <div className="student-practice-exam">
      <Link href={`${practice.href}?mode=exam`} prefetch={false}
        className={hasTopics ? studentAction(btnGhost, 'bg-student-surface') : studentAction(btnNavy, studentFocusDark)}>
        Exam mode
      </Link>
      <span className="student-meta">{practice.attemptSize} questions · {practice.timerSeconds / 60} min</span>
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

/** The bank topic names a bank course's overview lists, so its topics show once: none when Practice lists them, and
 * none for a course with its own syllabus topics, which its overview keeps. */
export function overviewBankTopics(bankTopics: ReadonlyArray<string> | undefined, practiceListsTopics: boolean,
  ownTopics: number): ReadonlyArray<string> | undefined {
  return bankTopics && bankTopics.length > 0 && !practiceListsTopics && ownTopics === 0 ? bankTopics : undefined
}

/** Published overview context; every block renders only when the managed payload carries it. A course whose questions
 * come from an official bank and that has no syllabus topics of its own lists the bank's topic names, in the bank's
 * order (see overviewBankTopics). */
export function OverviewSection({ overview, bankTopics, number }: {
  overview: ManagedOverview | null; bankTopics?: ReadonlyArray<string>; number: number
}): ReactElement {
  const topics = overview?.topics ?? [], examFocus = overview?.examFocus ?? []
  const bankList = topics.length > 0 ? [] : bankTopics ?? []
  const keyTakeaways = overview?.keyTakeaways ?? [], formulaSheet = overview?.formulaSheet ?? []
  const outcomes = overview?.outcomes ?? [], assessment = overview?.assessment ?? []
  // A course with only its bank topics gets no lede: the topic list is the overview.
  return <StudySection id="overview" number={number} lede={overview ? 'Explore the topics and key ideas for this course.' : undefined}>
    {overview?.body.trim() && <p className="student-detail-prose student-reading">{overview.body}</p>}
    {outcomes.length > 0 && <div className="student-detail-group">
      <h3>Course outcomes</h3>
      <ol className="student-detail-numbered student-surface">
        {outcomes.map((line, index) => <li key={index}><span>{pad2(index + 1)}</span><p className="student-detail-prose">{line}</p></li>)}
      </ol>
    </div>}
    {assessment.length > 0 && <div className="student-detail-group">
      <h3>How you’re assessed</h3>
      <ul className="student-detail-points student-surface">
        {assessment.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
    </div>}
    {keyTakeaways.length > 0 && <div className="student-detail-group">
      <h3>Key takeaways</h3>
      <ol className="student-detail-numbered student-surface">
        {keyTakeaways.map((item, index) => <li key={index}>
          <span>{pad2(index + 1)}</span>
          <div><p className="student-detail-strong">{item.title}</p><p className="student-detail-prose">{item.description}</p></div>
        </li>)}
      </ol>
    </div>}
    {bankList.length > 0 && <div className="student-detail-group">
      <h3>Syllabus topics</h3>
      <ol className="student-detail-numbered student-surface">
        {bankList.map((topic, index) => <li key={topic}><span>{pad2(index + 1)}</span><p className="student-detail-strong">{topic}</p></li>)}
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
      <div className="student-grid student-formula-grid">
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
  return <StudySection id="reading" number={number} lede="Use these textbooks to deepen your understanding of the course.">
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
