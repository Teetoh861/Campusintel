// Shared course card. Compact on phone; the exam-critical flag adds an accent
// wash. The homepage grid, course directory and bookmarks list share this
// component. The 3-bar difficulty indicator lives in <SignalBar>.
// (component-spec.md → Card)
import Link from 'next/link'
import { SignalBar } from './SignalBar'
import { cx } from './ui'
import type { DifficultyLevel } from './SignalBar'
import type { ReactElement, ReactNode } from 'react'

export type CardFlag = {
  // 'critical' is the lone amber accent for an exam-critical course;
  // 'tracked' is the muted default (no tag is rendered for it).
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
  // Short tagline shown under the title, above the meta row. When present it
  // also acts as the flexible spacer that keeps footers aligned across a grid
  // row; when absent an empty flex spacer does the same job.
  desc?: string
  flag?: CardFlag
  level: string
  credits: string
  questions?: string
  questionsRange?: string
  timeLimit: string
  difficulty: DifficultyLevel
  difficultyLabel?: string
  cta: CardCta
  // Optional extra action sitting next to the primary CTA. Used for the
  // exam-critical treatment where "View course" stays primary and "Start
  // quiz" is offered as an additional amber action.
  secondaryCta?: CardCta
  updated?: string
  ticks?: boolean
  // Optional interactive node appended to the right of the card footer. Only
  // the bookmarks list sets this (a Remove control); when absent the footer
  // renders exactly as before.
  footerAction?: ReactNode
  // Optional control pinned to the card's top-right corner (the bookmarks
  // Remove ×). Absolutely positioned over the card; the header padding leaves
  // room so it never collides with the exam-critical tag.
  cornerAction?: ReactNode
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Render a course card with separate space for an optional remove control. */
export function Card({
  code,
  title,
  desc,
  flag,
  level,
  credits,
  questions,
  questionsRange,
  difficulty,
  difficultyLabel,
  cta,
  secondaryCta,
  updated,
  footerAction,
  cornerAction,
}: CardProps): ReactElement {
  const critical = flag?.kind === 'critical'
  const diffLabel = difficultyLabel ?? titleCase(difficulty)

  return (
    <article
      className={cx(
        'relative flex flex-col rounded-ci-card border p-[var(--student-card-padding)] transition-[transform,box-shadow,border-color] duration-150',
        'hover:-translate-y-[2px] hover:shadow-ci-card hover:border-student-border-hover motion-reduce:transform-none motion-reduce:transition-none',
        critical
          ? 'border-student-accent-border bg-[linear-gradient(180deg,var(--student-accent-surface),var(--student-elevated-surface)_38%)]'
          : 'border-student-border bg-student-elevated-surface',
      )}
    >
      <Link
        href={cta.href}
        aria-label={`View ${code}: ${title}`}
        className="absolute inset-0 z-[1] rounded-ci-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-student-focus focus-visible:ring-offset-2"
      />
      {cornerAction ? <div className="absolute right-3 top-3 z-10">{cornerAction}</div> : null}
      <div className={cx('mb-3 flex items-start justify-between gap-3', Boolean(cornerAction) && 'pr-12')}>
        <span className="text-[13px] font-bold tracking-[0.08em] text-student-primary">{code}</span>
        {critical && flag ? (
          <span className="inline-flex items-center gap-[6px] text-[11px] font-bold uppercase tracking-[0.09em] text-student-accent-strong">
            <span className="h-[6px] w-[6px] rounded-full bg-student-accent" />
            {flag.label}
          </span>
        ) : null}
      </div>

      <h3 className={cx('text-[19px] font-bold leading-[1.2] tracking-[-0.02em] text-student-text-primary tablet:text-[21px]', Boolean(cornerAction) && 'pr-12')}>
        {title}
      </h3>

      {/* Optional one-line description, clamped to two lines so a longer course
          overview can't break footer alignment. A separate flex-1 spacer keeps
          meta + footer pinned to the bottom and aligned across the grid row,
          whether or not a card has a description. */}
      {desc ? (
        <p className="mt-2 line-clamp-2 text-[14px] leading-[1.45] text-student-text-secondary tablet:text-[15px]">{desc}</p>
      ) : null}
      <div className="flex-1" />

      <div className="mt-4 flex flex-wrap items-center gap-[7px] text-[13px] font-medium text-student-text-muted">
        <span>{level} level</span>
        <span className="h-[3px] w-[3px] rounded-full bg-student-text-faint" />
        <span>{credits}</span>
        {questions ? (
          <>
            <span className="h-[3px] w-[3px] rounded-full bg-student-text-faint" />
            <span>
              {questions} questions
              {questionsRange ? <span className="ml-1 text-student-text-faint">{questionsRange}</span> : null}
            </span>
          </>
        ) : null}
      </div>

      {/* Footer is two stacked rows: the difficulty indicator sits ABOVE a
          separate actions row. The actions row is locked to a single line
          (nowrap) with a fixed min-height, so a card with one action (View
          course) and an exam-critical card with two (View course + Start quiz)
          have the same footer height and stay aligned across the grid at every
          breakpoint. The exam-critical card's extra button never pushes its
          footer out of line with its row-mates. */}
      <div className="mt-4 border-t border-student-border pt-3 tablet:pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-[9px]">
            <SignalBar level={difficulty} />
            <span className="text-[12.5px] font-semibold tracking-[0.04em] text-student-text-secondary">
              {diffLabel}
            </span>
          </span>
          {footerAction ? (
            <span className="relative z-10 inline-flex items-center gap-3 whitespace-nowrap">
              {updated ? <span className="text-[12.5px] text-student-text-muted">{updated}</span> : null}
              {footerAction}
            </span>
          ) : null}
        </div>

        <div className="mt-2 flex min-h-11 flex-nowrap items-center gap-2">
          {/* Primary action — always present on every card, never replaced.
              Navy text cue for the card-wide link. */}
          <span className="inline-flex items-center whitespace-nowrap text-[15px] font-semibold text-student-primary">
            {cta.label}
          </span>
          {/* Exam-critical only — the lone amber "Start quiz", added alongside
              (not instead of) View course. Filled amber pill button. */}
          {secondaryCta ? (
            <Link
              href={secondaryCta.href}
              className="relative z-10 inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-ci-btn-sm bg-student-accent px-3 py-2 text-[13px] font-bold text-student-accent-text transition-colors duration-150 hover:bg-student-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-focus motion-reduce:transition-none"
            >
              {secondaryCta.label}
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  )
}
