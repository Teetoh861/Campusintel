// app/courses/[slug]/guide.tsx — Render a study guide topic from its validated tree of text. Every node becomes a React
// element with text children: nothing here, and nothing in a guide payload, is ever HTML.
import Link from 'next/link'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import type { GuideBlock, GuideSpan, GuideTopicPayload } from '@/lib/operator/editor-contract'
import type { ReactElement, ReactNode } from 'react'

/** Inline text: bold and italic flags only. */
export function GuideText({ spans }: { spans: ReadonlyArray<GuideSpan> }): ReactElement {
  return <>{spans.map((span, index) => {
    let node: ReactNode = span.text
    if (span.italic) node = <em>{node}</em>
    if (span.bold) node = <strong>{node}</strong>
    return <span key={index}>{node}</span>
  })}</>
}

const plain = (spans: ReadonlyArray<GuideSpan>) => spans.map(span => span.text).join('')

/** A table scrolls sideways inside its own box when it is wider than the page; the shading at an edge shows there is
 * more to see. The page itself never scrolls sideways. */
function GuideTable({ block }: { block: Extract<GuideBlock, { type: 'table' }> }): ReactElement {
  const label = block.header.map(plain).filter(Boolean).join(', ') || 'Table'
  return <div className="student-guide-table" role="region" aria-label={label} tabIndex={0}>
    <table>
      <thead><tr>{block.header.map((cell, index) => <th key={index} scope="col"><GuideText spans={cell} /></th>)}</tr></thead>
      <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>
        {row.map((cell, index) => <td key={index}><GuideText spans={cell} /></td>)}
      </tr>)}</tbody>
    </table>
  </div>
}

/** Blocks in order: paragraphs, lists (with their nested blocks), tables and preformatted text. */
export function GuideBlocks({ blocks }: { blocks: ReadonlyArray<GuideBlock> }): ReactElement {
  return <>{blocks.map((block, index) => {
    if (block.type === 'paragraph') return <p key={index} className="student-guide-p"><GuideText spans={block.text} /></p>
    if (block.type === 'preformatted') return <pre key={index} className="student-guide-pre">{block.text}</pre>
    if (block.type === 'table') return <GuideTable key={index} block={block} />
    const items = block.items.map((item, itemIndex) => <li key={itemIndex}>
      <GuideText spans={item.text} />
      {item.blocks && <GuideBlocks blocks={item.blocks} />}
    </li>)
    return block.ordered
      ? <ol key={index} className="student-guide-list" start={block.start}>{items}</ol>
      : <ul key={index} className="student-guide-list">{items}</ul>
  })}</>
}

export type GuideLinks = {
  // Opens this topic's practice; absent when the course has no practice the student can open.
  practiceHref?: string
  // Opens this topic's theory question on the theory page; absent when it cannot be practised there.
  theoryHref?: string
}

/** A whole guide topic: what to know, the lessons (Explain more folded until opened), the recap, the theory question
 * and the practice buttons. Headings start at `level` (2 on a topic page, 4 inside a note card). */
export function GuideTopicBody({ topic, links = {}, level = 2 }: {
  topic: GuideTopicPayload; links?: GuideLinks; level?: 2 | 4
}): ReactElement {
  const Heading = level === 2 ? 'h2' : 'h4'
  return <div className="student-guide">
    <div className="student-guide-know">
      <p className="student-detail-kicker">What you must know</p>
      <p className="student-guide-p"><GuideText spans={topic.mustKnow} /></p>
      {topic.introMore && <GuideBlocks blocks={topic.introMore} />}
    </div>
    {topic.lessons.map(lesson => <section key={lesson.number} className="student-guide-lesson"
      aria-label={`Lesson ${lesson.number}: ${lesson.title}`}>
      <Heading className="student-guide-heading">Lesson {lesson.number}: {lesson.title}</Heading>
      <p className="student-detail-kicker">Must know</p>
      <GuideBlocks blocks={lesson.mustKnow} />
      {lesson.explainMore && <details className="student-guide-more">
        <summary className="student-focus-control">Explain more</summary>
        <div className="student-guide-more-body"><GuideBlocks blocks={lesson.explainMore} /></div>
      </details>}
    </section>)}
    <section className="student-guide-lesson" aria-label="One-minute recap">
      <Heading className="student-guide-heading">One-minute recap</Heading>
      <GuideBlocks blocks={topic.recap} />
    </section>
    {topic.theory && <section className="student-guide-lesson" aria-label="Theory question">
      <Heading className="student-guide-heading">Theory question</Heading>
      <GuideBlocks blocks={topic.theory.question} />
      {links.theoryHref && <p><Link href={links.theoryHref} prefetch={false} className={studentAction(btnGhost, 'bg-student-surface')}>
        Answer this question
      </Link></p>}
    </section>}
    {topic.practice && links.practiceHref && <div className="student-guide-practice">
      {topic.practice.map(entry => <Link key={entry.topic} prefetch={false}
        href={`${links.practiceHref}?topic=${encodeURIComponent(entry.topic)}`} className={studentAction(btnNavy, studentFocusDark)}>
        {entry.named ? entry.topic : 'Practise this topic'}
      </Link>)}
    </div>}
  </div>
}
