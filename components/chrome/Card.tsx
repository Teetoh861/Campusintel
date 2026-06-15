// Card — course "dossier" card. Ports _design/bundle/course.bundle.html into
// a reusable Server Component used across the homepage grid, the course
// directory and the bookmarks list. Course-specific data flows in via props;
// the card itself stays presentational.
import Link from 'next/link'
import { SignalBar, type DifficultyLevel } from './SignalBar'

export type CardFlag = {
  // 'critical' is the lone teal accent for an exam-critical course;
  // 'tracked' is the muted default for everything else.
  kind: 'critical' | 'tracked'
  label: string
}

export type CardCta = {
  label: string
  href: string
  variant?: 'primary' | 'secondary'
  withArrow?: boolean
}

export type CardProps = {
  intelIndex?: string
  code: string
  title: string
  flag?: CardFlag
  level: string
  credits: string
  questions: string
  questionsRange?: string
  timeLimit: string
  difficulty: DifficultyLevel
  difficultyLabel?: string
  cta: CardCta
  updated?: string
  ticks?: boolean
}

export function Card({
  intelIndex,
  code,
  title,
  flag,
  level,
  credits,
  questions,
  questionsRange,
  timeLimit,
  difficulty,
  difficultyLabel,
  cta,
  updated,
  ticks = true,
}: CardProps) {
  const articleClass = ticks ? 'course ticks' : 'course'
  const ctaVariant = cta.variant ?? 'secondary'
  const ctaClass = `btn btn-${ctaVariant} btn-sm`
  const diffLabel = difficultyLabel ?? difficulty.toUpperCase()

  return (
    <article className={articleClass}>
      <div className="ch">
        <div>
          {intelIndex ? <div className="cx-idx">{intelIndex}</div> : null}
          <div className="code">{code}</div>
          <div className="ttl">{title}</div>
        </div>
        {flag ? (
          <div className={flag.kind === 'critical' ? 'flag' : 'flag plain'}>
            <span className="fd" />
            <span className="ft">{flag.label}</span>
          </div>
        ) : null}
      </div>

      <div className="readout">
        <Row k="Level" v={level} />
        <Row k="Credits" v={credits} />
        <Row k="Questions">
          {questions}
          {questionsRange ? <span className="dv">{questionsRange}</span> : null}
        </Row>
        <Row k="Time limit" v={timeLimit} />
        <Row k="Difficulty">
          <SignalBar level={difficulty} />
          {' '}
          {diffLabel}
        </Row>
      </div>

      <div className="cf">
        <Link className={ctaClass} href={cta.href}>
          {cta.label}
          {cta.withArrow ? <span className="arrow">&rarr;</span> : null}
        </Link>
        {updated ? <span className="upd">{updated}</span> : null}
      </div>
    </article>
  )
}

type RowProps = {
  k: string
  v?: string
  children?: React.ReactNode
}

function Row({ k, v, children }: RowProps) {
  return (
    <div className="r">
      <span className="k">{k}</span>
      <span className="v">{children ?? v}</span>
    </div>
  )
}
