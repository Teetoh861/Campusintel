// Shared three-bar difficulty indicator. Easy=1 lit, Medium=2, Hard=3.
export type DifficultyLevel = 'easy' | 'medium' | 'hard'

// Tone selects semantic colors for light surfaces or the navigation field.
type Tone = 'navy' | 'on-blue'

type Props = {
  level: DifficultyLevel
  tone?: Tone
  className?: string
}

const LIT_FOR: Record<DifficultyLevel, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
}

const BAR_HEIGHTS = ['h-[6px]', 'h-[9px]', 'h-[13px]']

const TONE: Record<Tone, { on: string; off: string }> = {
  navy: { on: 'bg-student-primary', off: 'bg-student-signal-track' },
  'on-blue': { on: 'bg-student-navigation-text', off: 'bg-student-signal-track-inverse' },
}

export function SignalBar({ level, tone = 'navy', className }: Props) {
  const lit = LIT_FOR[level]
  const palette = TONE[tone]
  return (
    <span
      className={`inline-flex h-[13px] items-end gap-[3px] ${className ?? ''}`}
      role="img"
      aria-label={`Difficulty: ${level}`}
    >
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={`w-1 rounded-[1px] ${h} ${i < lit ? palette.on : palette.off}`}
        />
      ))}
    </span>
  )
}
