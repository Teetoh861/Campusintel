// components/student/CampusBotArea.tsx — The one Campus Bot area of a notes topic, under the topic's own practice
// buttons: its label, then what Campus Bot does with this topic, side by side ("Ask a question", "Quiz me on this
// topic"). Each feature brings its own button as a child; a child with the class `student-campus-bot-wide` takes a
// whole row under the buttons (a progress line or a notice). A caller renders the area only when a feature is on.
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import type { ReactElement, ReactNode } from 'react'

export function CampusBotArea({ children }: { children: ReactNode }): ReactElement {
  return <section className="student-campus-bot-area" aria-labelledby="campus-bot-area-title">
    <h2 id="campus-bot-area-title" className="student-campus-bot-area-title">{CAMPUS_BOT_COPY.name}</h2>
    <div className="student-campus-bot-actions">{children}</div>
  </section>
}
