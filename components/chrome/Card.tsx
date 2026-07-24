// Card — Variant B course card (.ccard). White-on-warm surface, 1px border,
// soft hover lift; the exam-critical flag adds an amber tag + warm gradient
// wash. Reskin only: CardProps is unchanged so the homepage grid, the course
// directory and the bookmarks list keep passing the same data. The 3-bar
// difficulty indicator lives in <SignalBar>. (component-spec.md → Card)
import Link from 'next/link'
import { SignalBar, type DifficultyLevel } from './SignalBar'
import { cx } from './ui'

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
  questions: string
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
  footerAction?: React.ReactNode
  // Optional control pinned to the card's top-right corner (the bookmarks
  // Remove ×). Absolutely positioned over the card; the header padding leaves
  // room so it never collides with the exam-critical tag.
  cornerAction?: React.ReactNode
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
}: CardProps) {
  const critical = flag?.kind === 'critical'
  const diffLabel = difficultyLabel ?? titleCase(difficulty)

  return (
    <article
      className={cx(
        'relative flex flex-col rounded-[16px] border p-[26px_24px] transition-[transform,box-shadow,border-color] duration-200',
        'hover:-translate-y-[3px] hover:shadow-ci-card hover:border-ci-border-2',
        critical
          ? 'border-ci-accent-100 bg-[linear-gradient(180deg,var(--ci-accent-50),var(--ci-white)_38%)]'
          : 'border-ci-border bg-ci-white',
      )}
    >
      <Link
        href={cta.href}
        aria-label={`View ${code}: ${title}`}
        className="absolute inset-0 z-[1] rounded-[16px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ci-accent focus-visible:ring-offset-2"
      />
      {cornerAction ? <div className="absolute right-3 top-3 z-10">{cornerAction}</div> : null}
      <div className={cx('mb-4 flex items-start justify-between gap-[14px]', Boolean(cornerAction) && 'pr-8')}>
        <span className="text-[13px] font-bold tracking-[0.08em] text-ci-navy">{code}</span>
        {critical && flag ? (
          <span className="inline-flex items-center gap-[6px] text-[11px] font-bold uppercase tracking-[0.09em] text-ci-accent-600">
            <span className="h-[6px] w-[6px] rounded-full bg-ci-accent" />
            {flag.label}
          </span>
        ) : null}
      </div>

      <h3 className="text-[22px] font-bold leading-[1.12] tracking-[-0.02em] text-ci-navy-900">
        {title}
      </h3>

      {/* Optional one-line description, clamped to two lines so a longer course
          overview can't break footer alignment. A separate flex-1 spacer keeps
          meta + footer pinned to the bottom and aligned across the grid row,
          whether or not a card has a description. */}
      {desc ? (
        <p className="mt-[11px] line-clamp-2 text-[15px] leading-[1.5] text-ci-gray-600">{desc}</p>
      ) : null}
      <div className="flex-1" />

      <div className="mt-5 flex flex-wrap items-center gap-[7px] text-[13px] font-medium text-ci-gray-500">
        <span>{level} level</span>
        <span className="h-[3px] w-[3px] rounded-full bg-ci-gray-400" />
        <span>{credits}</span>
        <span className="h-[3px] w-[3px] rounded-full bg-ci-gray-400" />
        <span>
          {questions} questions
          {questionsRange ? <span className="ml-1 text-ci-gray-400">{questionsRange}</span> : null}
        </span>
      </div>

      {/* Footer is two stacked rows: the difficulty indicator sits ABOVE a
          separate actions row. The actions row is locked to a single line
          (nowrap) with a fixed min-height, so a card with one action (View
          course) and an exam-critical card with two (View course + Start quiz)
          have the same footer height and stay aligned across the grid at every
          breakpoint. The exam-critical card's extra button never pushes its
          footer out of line with its row-mates. */}
      <div className="mt-5 border-t border-ci-border pt-[18px]">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-[9px]">
            <SignalBar level={difficulty} />
            <span className="text-[12.5px] font-semibold tracking-[0.04em] text-ci-gray-600">
              {diffLabel}
            </span>
          </span>
          {footerAction ? (
            <span className="relative z-10 inline-flex items-center gap-3 whitespace-nowrap">
              {updated ? <span className="text-[12.5px] text-ci-gray-500">{updated}</span> : null}
              {footerAction}
            </span>
          ) : null}
        </div>

        <div className="mt-[15px] flex min-h-[38px] flex-nowrap items-center gap-[10px]">
          {/* Primary action — always present on every card, never replaced.
              Navy text cue for the card-wide link. */}
          <span className="inline-flex items-center whitespace-nowrap text-[15px] font-semibold text-ci-navy">
            {cta.label}
          </span>
          {/* Exam-critical only — the lone amber "Start quiz", added alongside
              (not instead of) View course. Filled amber pill button. */}
          {secondaryCta ? (
            <Link
              href={secondaryCta.href}
              className="relative z-10 inline-flex min-h-[36px] items-center gap-[6px] whitespace-nowrap rounded-[8px] bg-ci-accent px-3 py-2 text-[13px] font-bold text-ci-navy-900 transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-ci-accent-600"
            >
              {secondaryCta.label}
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  )
}
