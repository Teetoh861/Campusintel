// app/payment-terms/page.tsx — Payment terms, as the owner approved them. Public: a student can read it before signing in
// or paying. The copy lives in lib/entitlements/presentation.ts (TERMS_COPY).
import Link from 'next/link'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { TERMS_COPY, naira } from '@/lib/entitlements/presentation'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { whatsAppChatUrl } from '@/lib/whatsapp'
import type { ReactElement } from 'react'

export const metadata = { title: 'Payment terms | CampusIntell' }

const LINK = 'font-semibold text-student-primary underline underline-offset-2'

/** The app's message-us link: WhatsApp when a number is configured, otherwise Help & Support. */
function MessageUs({ text }: { text: string }): ReactElement {
  const chat = whatsAppChatUrl()
  return chat !== null
    ? <a href={chat} target="_blank" rel="noopener noreferrer" className={LINK}>{text}</a>
    : <Link href={STUDENT_DESTINATIONS.contact.href} prefetch={false} className={LINK}>{text}</Link>
}

/** A body line with each "message us" as the message-us link. */
function Body({ text }: { text: string }): ReactElement {
  return <p className="mt-2 text-student-text-secondary">
    {text.split(/([Mm]essage us)/).map((part, index) => index % 2 === 1 ? <MessageUs key={index} text={part} /> : part)}
  </p>
}

export default function PaymentTermsPage(): ReactElement {
  const { table } = TERMS_COPY
  return <StudentPage band={<PageBand title={TERMS_COPY.title} />}>
    <div className="grid max-w-[680px] gap-6">
      <section aria-label="Prices">
        <table className="w-full border-collapse overflow-hidden rounded-lg border border-student-border bg-student-surface text-left">
          <thead>
            <tr className="border-b border-student-border">
              <td className="px-3 py-3" />
              {table.columns.map(column => <th key={column} scope="col"
                className="px-3 py-3 text-sm font-semibold text-student-text-secondary">{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map(row => <tr key={row.plan} className="border-b border-student-border last:border-b-0">
              <th scope="row" className="px-3 py-3 font-semibold text-student-text-primary">{row.plan}</th>
              <td className="px-3 py-3 font-semibold text-student-text-primary">{naira(row.semesterKobo)}</td>
              <td className="px-3 py-3 font-semibold text-student-text-primary">{naira(row.sessionKobo)}</td>
            </tr>)}
          </tbody>
        </table>
        <p className="mt-3 text-student-text-secondary">{TERMS_COPY.intro}</p>
      </section>
      {TERMS_COPY.sections.map(section => <section key={section.heading} aria-labelledby={`terms-${section.heading}`}>
        <h2 id={`terms-${section.heading}`} className="student-section-title">{section.heading}</h2>
        <Body text={section.body} />
      </section>)}
    </div>
  </StudentPage>
}
