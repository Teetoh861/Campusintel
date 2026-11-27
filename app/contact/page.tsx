import { btnAccent, btnGhost } from '@/components/chrome/ui'
import { SelectionSummary } from '@/components/profile/SelectionSummary'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction } from '@/components/student/ui'
import { CONTACT_EMAIL } from '@/lib/contact'
import { getCurrentStudentProfile } from '@/lib/profile/student-profile'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { whatsAppChatUrl } from '@/lib/whatsapp'
import type { ReactElement } from 'react'

// Public support routes with private selection details only for the verified current student.
export const dynamic = 'force-dynamic'
export const metadata = { title: `${STUDENT_DESTINATIONS.contact.label} | CampusIntell` }

const ROUTES = [
  { title: 'Report a wrong question or answer', message: 'Hello CampusIntell, I want to report a wrong question or answer.' },
  { title: "Something isn't working", message: "Hello CampusIntell, something isn't working." },
  { title: 'Ask about my subscription', message: 'Hello CampusIntell, I have a question about my subscription.' },
] as const

/** Offer both existing contact methods, with the student's chosen reason already filled in. */
function ContactActions({ subject, message }: { subject: string; message: string }): ReactElement {
  const whatsapp = whatsAppChatUrl(message)
  const email = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
  return <div className="mt-3 flex flex-wrap gap-3">
    {whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={studentAction(btnAccent)}>
      WhatsApp
    </a>}
    <a href={email} className={studentAction(btnGhost)}>Email</a>
  </div>
}

/** Show support choices and, when available, only this student's saved academic selection. */
export default async function ContactPage(): Promise<ReactElement> {
  const profile = await getCurrentStudentProfile()
  const selection = profile.status === 'complete' || profile.status === 'incomplete' ? profile.selection : undefined
  const current = selection ? [selection.department.label, selection.academicLevel.label, selection.academicPeriod.label].join(' · ') : null
  return <StudentPage band={<PageBand title={STUDENT_DESTINATIONS.contact.label} />}>
    <div className="student-stack max-w-[680px]">
      {selection && current && <section id="your-courses" aria-labelledby="your-courses-heading" className="student-surface student-anchor">
        <h2 id="your-courses-heading" className="student-section-title">Your courses are set from</h2>
        <div className="mt-3"><SelectionSummary selection={selection} /></div>
        <h3 className="mt-4 font-semibold text-student-text-primary">Request a change</h3>
        <ContactActions subject="Request a change to my courses"
          message={`Hello CampusIntell, I'd like to request a change to my department, level or semester. My current selection is ${current}.`} />
      </section>}
      {ROUTES.map((route, index) => <section key={route.title} aria-labelledby={`contact-route-${index}`} className="student-surface">
        <h2 id={`contact-route-${index}`} className="student-section-title">{route.title}</h2>
        <ContactActions subject={route.title} message={route.message} />
      </section>)}
      <p className="text-sm text-student-text-secondary">We reply within a day, Monday to Saturday, 9 am to 6 pm.</p>
    </div>
  </StudentPage>
}
