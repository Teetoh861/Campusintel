// Card — Variant B course card (.ccard). White-on-warm surface, 1px border,
// soft hover lift; the exam-critical flag adds an amber tag + warm gradient
// wash. Reskin only: CardProps is unchanged so the homepage grid, the course
// directory and the bookmarks list keep passing the same data. The 3-bar
// difficulty indicator lives in <SignalBar>. (component-spec.md → Card)
import Link from 'next/link'
import { SignalBar, type DifficultyLevel } from './SignalBar'
import { Arrow, cx } from './ui'

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
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function Card({
  code,
  title,
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
      <div className="mb-4 flex items-start justify-between gap-[14px]">
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

      {/* spacer keeps footers aligned across the grid (no desc field) */}
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

      <div className="mt-5 flex items-center justify-between gap-[14px] border-t border-ci-border pt-[18px]">
        <span className="inline-flex items-center gap-[9px]">
          <SignalBar level={difficulty} />
          <span className="text-[12.5px] font-semibold tracking-[0.04em] text-ci-gray-600">
            {diffLabel}
          </span>
        </span>

        <div className="flex items-center gap-4">
          {secondaryCta ? (
            <Link
              href={secondaryCta.href}
              className="group inline-flex items-center gap-2 text-[15px] font-semibold text-ci-accent-600 transition-[gap] duration-150 hover:gap-3"
            >
              {secondaryCta.label}
              {secondaryCta.withArrow ? <Arrow /> : null}
            </Link>
          ) : null}
          <Link
            href={cta.href}
            className="group inline-flex items-center gap-2 text-[15px] font-semibold text-ci-navy transition-[gap] duration-150 hover:gap-3"
          >
            {cta.label}
            {cta.withArrow ? <Arrow /> : null}
          </Link>
          {footerAction ? (
            <span className="inline-flex items-center gap-3">
              {updated ? <span className="text-[12.5px] text-ci-gray-500">{updated}</span> : null}
              {footerAction}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  )
}
