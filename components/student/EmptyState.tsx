// components/student/EmptyState.tsx — Honest empty academic state with real recovery destinations.
import { BookOpen } from 'lucide-react'
import { useId } from 'react'
import type { ReactElement, ReactNode } from 'react'

/** Explain an empty set without presenting it as a loading or failure state; safe to render more than once. */
export function EmptyState({ id, icon, title, children, actions }: {
  id?: string
  icon?: ReactNode | null
  title: string
  children: ReactNode
  actions: ReactNode
}): ReactElement {
  const generatedId = useId()
  const headingId = id ?? `student-empty-title${generatedId}`
  const mark = icon === undefined ? <BookOpen aria-hidden="true" size={22} strokeWidth={1.75} /> : icon
  return <section className="student-empty-state" aria-labelledby={headingId}>
    {mark !== null && <span className="student-empty-icon">{mark}</span>}
    <h2 id={headingId} className="student-empty-title">{title}</h2>
    <p className="student-empty-text">{children}</p>
    <div className="student-empty-actions">{actions}</div>
  </section>
}
