// SignalBar — Variant B difficulty indicator: three rising bars (4px wide,
// heights 6/9/13px). "off" bars are ci-blue-100, lit bars ci-navy. Easy=1 lit,
// Medium=2, Hard=3. Never colored pills. (component-spec.md → Card · Difficulty)
export type DifficultyLevel = 'easy' | 'medium' | 'hard'

// tone controls the palette: the default warm-surface variant (navy lit bars on
// ci-blue-100) and the on-blue cover variant (white lit bars on white-alpha).
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
  navy: { on: 'bg-ci-navy', off: 'bg-ci-blue-100' },
  'on-blue': { on: 'bg-white', off: 'bg-white/[0.26]' },
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
