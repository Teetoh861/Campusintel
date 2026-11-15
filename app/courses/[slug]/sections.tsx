// app/courses/[slug]/sections.tsx — Study-hub renderers for central Course Detail payloads; no truth derivation here.
import Link from 'next/link'
import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { btnGhost } from '@/components/chrome/ui'
import { studentAction } from '@/components/student/ui'
import { STUDY_FAMILIES } from '@/components/student/study-families'
import { topicsLine } from '@/lib/practice/topics'
import { GuideTopicBody } from './guide'
import { PRACTICE_COPY } from './quiz/practice-presentation'
import type { GuideLinks } from './guide'
import type { StudyFamilyId } from '@/components/student/study-families'
import type { StudentCoursePractice, StudentCourseDetailLearning, StudyAvailability } from '@/lib/courses/read-model'
import type { ManagedNote, ManagedOverview } from '@/lib/managed-content/student-projection'
import type { PracticeTopicRow } from '@/lib/practice/topics'
import type { Textbook } from '@/lib/types'
import type { ReactElement, ReactNode } from 'react'


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
  return [...families, ...(overviewShown(learning?.overview) ? ['overview' as const] : []),
    ...(textbooks > 0 ? ['reading' as const] : [])]
}

/** Whether a stored overview has anything the course page shows. Its syllabus topics are not shown: a course's topics
 * are in its Notes and its Practice. */
export function overviewShown(overview: ManagedOverview | null | undefined): overview is ManagedOverview {
  if (overview === null || overview === undefined) return false
  return overview.body.trim() !== '' || [overview.outcomes, overview.assessment, overview.keyTakeaways, overview.examFocus,
    overview.formulaSheet].some(list => (list?.length ?? 0) > 0)
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

const countOf = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`

/** One choice on a study card: what it opens and one line about it. The whole row taps. A card with one choice is the
 * row itself (student-topic-card sets the width every card shares); a card with two holds two rows. */
function CardRow({ href, title, line, card = false }: { href: string; title: string; line: string; card?: boolean }): ReactElement {
  return <Link href={href} prefetch={false}
    className={card ? 'student-topic-row student-topic-card student-focus-control' : 'student-topic-row student-focus-control'}>
    <span className="student-topic-text"><b>{title}</b><span>{line}</span></span>
    <ChevronRight aria-hidden="true" size={20} strokeWidth={2} className="student-topic-go" />
  </Link>
}

/** Notes on the course page: one compact card that opens the topic list. Each topic is read on its own page. */
export function NotesCard({ notes, href, number }: {
  notes: ReadonlyArray<ManagedNote>; href: string; number: number
}): ReactElement {
  return <StudySection id="notes" number={number}>
    <CardRow card href={href} title="Open notes" line={countOf(notes.length, 'topic')} />
  </StudySection>
}

/** Practice on the course page: one card. With topics it offers Practise by topic, whose page lists them (the line
 * says how many there are, or how many the student has practised), and Exam mode. A course without topics offers Exam
 * mode only. */
export function PracticeCard({ practice, topics, topicsHref, number }: {
  practice: StudentCoursePractice; topics: ReadonlyArray<Pick<PracticeTopicRow, 'practised'>>; topicsHref: string; number: number
}): ReactElement {
  const exam = (card: boolean) => <CardRow card={card} href={`${practice.href}?mode=exam`} title={PRACTICE_COPY.examMode}
    line={`${practice.attemptSize} questions · ${practice.timerSeconds / 60} min`} />
  return <StudySection id="cbtPractice" number={number}>
    {topics.length === 0 ? exam(true) : <div className="student-topic-card student-topic-choices">
      <CardRow href={topicsHref} title={PRACTICE_COPY.byTopic} line={topicsLine(topics)} />
      {exam(false)}
    </div>}
  </StudySection>
}

/** Theory on the course page: one card that opens theory practice, where every question is read and answered. */
export function TheoryCard({ questions, href, number }: { questions: number; href: string; number: number }): ReactElement {
  return <StudySection id="theory" number={number}>
    <CardRow card href={href} title="Start theory practice" line={countOf(questions, 'question')} />
  </StudySection>
}

/** Published overview context; every block renders only when the managed payload carries it. No list of topics shows
 * here, neither the stored syllabus nor the practice topics: topics are in Notes and on the Practise by topic page. */
export function OverviewSection({ overview, number }: { overview: ManagedOverview; number: number }): ReactElement {
  const examFocus = overview.examFocus ?? []
  const keyTakeaways = overview.keyTakeaways ?? [], formulaSheet = overview.formulaSheet ?? []
  const outcomes = overview.outcomes ?? [], assessment = overview.assessment ?? []
  return <StudySection id="overview" number={number}>
    {overview.body.trim() && <p className="student-detail-prose student-reading">{overview.body}</p>}
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
