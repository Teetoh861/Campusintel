// components/student/EmptyState.tsx — Honest empty academic state with real recovery destinations.
import { BookOpen } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

/** Explain an empty course set without presenting it as a loading or failure state. */
export function EmptyState({ title, children, actions }: {
  title: string
  children: ReactNode
  actions: ReactNode
}): ReactElement {
  return <section className="student-empty-state" aria-labelledby="student-empty-title">
    <span className="student-empty-icon"><BookOpen aria-hidden="true" size={22} strokeWidth={1.75} /></span>
    <h2 id="student-empty-title" className="student-empty-title">{title}</h2>
    <p className="student-empty-text">{children}</p>
    <div className="student-empty-actions">{actions}</div>
  </section>
}
