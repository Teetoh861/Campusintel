// app/payment-terms/page.tsx — Payment terms: the full refund rule in plain words (PENDING OWNER APPROVAL). Public: a
// student can read it before signing in or paying. The copy lives in lib/entitlements/presentation.ts (TERMS_COPY).
import Link from 'next/link'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { TERMS_COPY } from '@/lib/entitlements/presentation'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import type { ReactElement } from 'react'

export const metadata = { title: 'Payment terms | CampusIntell' }

export default function PaymentTermsPage(): ReactElement {
  return <StudentPage band={<PageBand title={TERMS_COPY.title} />}>
    <div className="grid max-w-[680px] gap-6">
      {TERMS_COPY.sections.map(section => <section key={section.heading} aria-labelledby={`terms-${section.heading}`}>
        <h2 id={`terms-${section.heading}`} className="student-section-title">{section.heading}</h2>
        {section.body.map(line => <p key={line} className="mt-2 text-student-text-secondary">{line}</p>)}
      </section>)}
      <p><Link href={STUDENT_DESTINATIONS.contact.href} prefetch={false}
        className="inline-flex min-h-11 items-center font-semibold text-student-primary underline underline-offset-2">
        {STUDENT_DESTINATIONS.contact.label}</Link></p>
    </div>
  </StudentPage>
}
