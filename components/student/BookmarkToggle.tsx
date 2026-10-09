// components/student/BookmarkToggle.tsx — One reversible bookmark control with a stable name and visible pressed state.
import type { ReactElement } from 'react'

/** Present bookmark state without treating an ordinary toggle as a destructive action. */
export function BookmarkToggle({ pressed, onClick, disabled = false, label = 'Bookmark',
  text, tone = 'light' }: {
  pressed: boolean
  onClick: () => void
  disabled?: boolean
  label?: string
  text?: string
  tone?: 'light' | 'dark'
}): ReactElement {
  return <button type="button" aria-label={label} aria-pressed={pressed} disabled={disabled}
    onClick={onClick} data-tone={tone} className="student-bookmark-toggle student-focus-control">
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill={pressed ? 'currentColor' : 'none'}>
      <path d="M7 4.75A1.75 1.75 0 0 1 8.75 3h6.5A1.75 1.75 0 0 1 17 4.75v15l-5-3.2-5 3.2v-15Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    {text && <span>{text}</span>}
  </button>
}
