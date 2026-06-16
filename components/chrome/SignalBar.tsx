// SignalBar — monochrome difficulty indicator (signal-strength bars).
// Three rising bars (b1 < b2 < b3); the lit ones are filled with --n-800.
// Used in course cards and on the course-detail cover-meta strip.
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

export function SignalBar({ level, className }: Props) {
  const lit = LIT_FOR[level]
  const cls = className ? `sig-bars ${className}` : 'sig-bars'
  return (
    <span className={cls} role="img" aria-label={`Difficulty: ${level}`}>
      <span className={`b b1${lit >= 1 ? ' on' : ''}`} />
      <span className={`b b2${lit >= 2 ? ' on' : ''}`} />
      <span className={`b b3${lit >= 3 ? ' on' : ''}`} />
    </span>
  )
}
