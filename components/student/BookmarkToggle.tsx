// components/student/BookmarkToggle.tsx — One reversible bookmark control with a stable name and visible pressed state.
import { Bookmark } from 'lucide-react'
import type { ReactElement } from 'react'

const ICON_SIZE = 22

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
    <Bookmark aria-hidden="true" size={ICON_SIZE} strokeWidth={1.8}
      fill={pressed ? 'currentColor' : 'none'} />
    {text && <span>{text}</span>}
  </button>
}
