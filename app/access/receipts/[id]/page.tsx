// app/access/receipts/[id]/page.tsx — One receipt for the student's own payment, from our order (never the provider's).
// The student can save or print it. Another student's order and an unknown id read the same.
import Link from 'next/link'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { RETURN_COPY, formatAccessDate, naira, paymentReference, planName } from '@/lib/entitlements/presentation'
import { readOrderAnswer } from '@/lib/payments/order-view'
import { RECEIPTS_PATH } from '@/lib/payments/paths'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { PrintReceipt } from './PrintReceipt'
import type { OrderView } from '@/lib/payments/order-view'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Receipt | CampusIntell', robots: { index: false, follow: false } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RECEIPTED: ReadonlySet<OrderView['state']> = new Set(['paid', 'paid-duplicate', 'refund-pending', 'refunded'])
const STATUS_LINE: Partial<Record<OrderView['state'], string>> = {
  'paid': 'Paid', 'paid-duplicate': 'Paid twice: the extra payment is being refunded', 'refund-pending': 'Refund in progress',
  'refunded': 'Refunded',
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }): Promise<ReactElement> {
  const { id } = await params
  const here = `${RECEIPTS_PATH}/${encodeURIComponent(id)}`
  return <StudentAccessGate returnPath={here}><Receipt id={id} here={here} /></StudentAccessGate>
}

async function Receipt({ id, here }: { id: string; here: string }): Promise<ReactElement> {
  const client = await createClient()
  const context = await getStudentSessionContext(undefined, client)
  if (context === null) return redirectForStudentState('signed-out', here)
  let order: OrderView | null = null
  if (UUID.test(id)) {
    const { data, error } = await client.rpc('get_my_payment_order', { p_order_id: id.toLowerCase() })
      .then(answer => answer, () => ({ data: null, error: { code: 'unavailable' } }))
    if (error?.code === '42501') return redirectForStudentState('signed-out', here)
    const read = error ? null : readOrderAnswer(200, data)
    order = read?.kind === 'order' && RECEIPTED.has(read.order.state) && read.order.paid_at !== null ? read.order : null
  }
  const back = <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false}
    className={studentAction(btnGhost, 'bg-student-surface')}>{RETURN_COPY.backToAccess}</Link>
  if (order === null) return <StudentPage band={<PageBand title="Receipt" />}>
    <Notice tone="info" title={RETURN_COPY.notFoundTitle} action={back}>{RETURN_COPY.notFoundBody}</Notice>
  </StudentPage>
  const rows: Array<[string, string]> = [['Plan', planName(order.tier, order.period)], ['Amount', naira(order.amount_kobo)],
    ['Paid', formatAccessDate(order.paid_at!)], [RETURN_COPY.reference, paymentReference(order.order_id)],
    ['Order', order.order_id], ['Status', STATUS_LINE[order.state] ?? 'Paid']]
  return <StudentPage band={<PageBand title="Receipt" context={<p>CampusIntell</p>} />}>
    <div className="mx-auto grid w-full max-w-[560px] gap-6">
      <dl className="student-surface grid py-1 text-sm">
        {rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b border-student-border py-3
          last:border-b-0">
          <dt className="text-student-text-secondary">{label}</dt>
          <dd className="break-all text-right font-semibold text-student-text-primary">{value}</dd>
        </div>)}
      </dl>
      <div className="grid gap-2 tablet:flex print:hidden">
        <PrintReceipt className={studentAction(btnNavy, studentFocusDark)} />
        {back}
      </div>
    </div>
  </StudentPage>
}
