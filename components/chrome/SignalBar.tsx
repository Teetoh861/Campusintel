// SignalBar — Variant B difficulty indicator: three rising bars (4px wide,
// heights 6/9/13px). "off" bars are ci-blue-100, lit bars ci-navy. Easy=1 lit,
// Medium=2, Hard=3. Never colored pills. (component-spec.md → Card · Difficulty)
export type DifficultyLevel = 'easy' | 'medium' | 'hard'

type Props = {
  level: DifficultyLevel
  className?: string
}

const LIT_FOR: Record<DifficultyLevel, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
}

const BARS = [
  { h: 'h-[6px]' },
  { h: 'h-[9px]' },
  { h: 'h-[13px]' },
]

export function SignalBar({ level, className }: Props) {
  const lit = LIT_FOR[level]
  return (
    <span
      className={`inline-flex h-[13px] items-end gap-[3px] ${className ?? ''}`}
      role="img"
      aria-label={`Difficulty: ${level}`}
    >
      {BARS.map((bar, i) => (
        <span
          key={i}
          className={`w-1 rounded-[1px] ${bar.h} ${i < lit ? 'bg-ci-navy' : 'bg-ci-blue-100'}`}
        />
      ))}
    </span>
  )
}
