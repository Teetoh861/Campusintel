// components/student/BookmarkToggle.tsx — One reversible bookmark control with a stable name and visible pressed state.
import { Bookmark, LoaderCircle } from 'lucide-react'
import type { ReactElement, Ref } from 'react'

const ICON_SIZE = 22

/** Present bookmark state without treating an ordinary toggle as a destructive action.
 * While `busy`, the control keeps its pressed state (nothing durable has changed yet),
 * reports aria-busy, ignores repeated activation and shows the library spinner.
 */
export function BookmarkToggle({ pressed, onClick, disabled = false, busy = false, label = 'Bookmark',
  text, tone = 'light', ref }: {
  pressed: boolean
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  label?: string
  text?: string
  tone?: 'light' | 'dark'
  // Lets a list owner return focus to a sibling control after a confirmed mutation.
  ref?: Ref<HTMLButtonElement>
}): ReactElement {
  return <button type="button" ref={ref} aria-label={label} aria-pressed={pressed} disabled={disabled}
    aria-busy={busy || undefined} aria-disabled={busy || undefined}
    onClick={busy ? undefined : onClick} data-tone={tone} className="student-bookmark-toggle student-focus-control">
    {busy
      ? <LoaderCircle aria-hidden="true" size={ICON_SIZE} strokeWidth={1.8} className="animate-spin motion-reduce:animate-none" />
      : <Bookmark aria-hidden="true" size={ICON_SIZE} strokeWidth={1.8} fill={pressed ? 'currentColor' : 'none'} />}
    {text && <span>{text}</span>}
  </button>
}
