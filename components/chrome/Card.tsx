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
  // Optional extra action sitting next to the primary CTA. Used for the
  // exam-critical treatment where "View course" stays primary and "Start
  // quiz" is offered as an additional secondary action.
  secondaryCta?: CardCta
  updated?: string
  ticks?: boolean
  // Optional interactive node appended to the right of the card footer. Only
  // the bookmarks list sets this (a Remove control); when absent the footer
  // renders exactly as before, so homepage/directory cards are unchanged.
  footerAction?: React.ReactNode
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
  secondaryCta,
  updated,
  ticks = true,
  footerAction,
}: CardProps) {
  const articleClass = ticks ? 'course ticks' : 'course'
  const ctaVariant = cta.variant ?? 'secondary'
  const ctaClass = `btn btn-${ctaVariant} btn-sm`
  const diffLabel = difficultyLabel ?? difficulty.toUpperCase()
  const secondaryVariant = secondaryCta?.variant ?? 'secondary'
  const secondaryClass = `btn btn-${secondaryVariant} btn-sm`

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
        {secondaryCta ? (
          // Wrap both actions in a single flex item so the .cf row stays a
          // tidy [actions group] [updated] layout. The pair sits primary-then-
          // secondary in the same row, wrapping to a column on cards too
          // narrow to fit them — mirroring the .hero-cta column→row pattern.
          <div style={cfActionsStyle}>
            <Link className={ctaClass} href={cta.href}>
              {cta.label}
              {cta.withArrow ? <span className="arrow">&rarr;</span> : null}
            </Link>
            <Link className={secondaryClass} href={secondaryCta.href}>
              {secondaryCta.label}
              {secondaryCta.withArrow ? <span className="arrow">&rarr;</span> : null}
            </Link>
          </div>
        ) : (
          <Link className={ctaClass} href={cta.href}>
            {cta.label}
            {cta.withArrow ? <span className="arrow">&rarr;</span> : null}
          </Link>
        )}
        {footerAction ? (
          // Bookmarks-only branch: group the (optional) updated stamp and the
          // Remove control on the footer's right. Non-bookmark cards never set
          // footerAction, so they keep the original [cta] [upd] markup.
          <div className="bm-cf-right">
            {updated ? <span className="upd">{updated}</span> : null}
            {footerAction}
          </div>
        ) : updated ? (
          <span className="upd">{updated}</span>
        ) : null}
      </div>
    </article>
  )
}

const cfActionsStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 8,
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
