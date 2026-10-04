// Shared action styles for student and public chrome. Colors come from the
// semantic student roles; every action remains at least 44px high on phone.

export const btnBase =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-ci-btn border border-transparent px-5 py-2.5 text-[15px] font-semibold leading-5 text-center transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-student-disabled-surface disabled:text-student-disabled disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:bg-student-disabled-surface aria-disabled:text-student-disabled motion-reduce:transform-none motion-reduce:transition-none'

export const btnSm = 'min-h-11 rounded-ci-btn-sm px-4 py-2 text-[14px] tablet:text-[15px]'

// Retain the exported name while using the accessible semantic focus color.
export const focusRingNavy =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-focus'

export const btnAccent =
  'bg-student-accent text-student-accent-text hover:bg-student-accent-hover active:bg-student-accent'

export const btnNavy =
  'bg-student-primary text-student-primary-text hover:bg-student-primary-hover active:bg-student-navigation'

export const btnWhite =
  'bg-student-surface text-student-primary hover:bg-student-brand-surface active:bg-student-surface-muted'

export const btnGhost =
  'border-student-border-strong bg-transparent text-student-primary hover:border-student-primary hover:bg-student-brand-surface active:bg-student-surface-muted'

export const btnGhostOnBlue =
  'border-student-navigation-outline bg-transparent text-student-navigation-text hover:border-student-navigation-text hover:bg-student-navigation-hover active:bg-student-navigation-current focus-visible:!outline-student-focus-inverse'

export const btnLight =
  'bg-student-elevated-surface text-student-primary hover:bg-student-brand-surface active:bg-student-surface-muted focus-visible:!outline-student-focus-inverse'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
