// app/access/checkout/return/page.tsx — Back from payment. It shows our own order's state only: every query parameter
// our payment partner adds is ignored, and nothing says paid until our database does. Another student's order and an
// unknown id read the same: "We couldn't find that payment".
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentCoursesForVerifiedStudent } from '@/lib/courses/read-model'
import { unlockedFeatures } from '@/lib/entitlements/presentation'
import { readOrderAnswer } from '@/lib/payments/order-view'
import { createClient } from '@/lib/supabase/server'
import { ReturnStatus } from './ReturnStatus'
import type { OrderRead } from '@/lib/payments/order-view'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your payment | CampusIntell', robots: { index: false, follow: false } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<{ order?: string }> }):
  Promise<ReactElement> {
  const { order } = await searchParams
  const orderId = typeof order === 'string' && UUID.test(order) ? order.toLowerCase() : null
  const here = orderId === null ? '/access/checkout/return' : `/access/checkout/return?order=${orderId}`
  return <StudentAccessGate returnPath={here}><PaymentReturn orderId={orderId} here={here} /></StudentAccessGate>
}

async function PaymentReturn({ orderId, here }: { orderId: string | null; here: string }): Promise<ReactElement> {
  const client = await createClient()
  const context = await getStudentSessionContext(undefined, client)
  if (context === null) return redirectForStudentState('signed-out', here)
  let initial: OrderRead = { kind: 'not-found' }
  if (orderId !== null) {
    try {
      const { data, error } = await client.rpc('get_my_payment_order', { p_order_id: orderId })
      initial = error ? { kind: error.code === '42501' ? 'signed-out' : 'unavailable' } : readOrderAnswer(200, data)
    } catch { initial = { kind: 'unavailable' } }
  }
  if (initial.kind === 'signed-out') return redirectForStudentState('signed-out', here)
  const current = await getCurrentStudentCoursesForVerifiedStudent(client, context.user).catch(() => null)
  return <StudentPage>
    <ReturnStatus orderId={orderId} initial={initial} courseCount={current?.status === 'ok' ? current.courses.length : 0}
      features={current?.status === 'ok' ? unlockedFeatures(current.courses.map(course => course.content)) : null} />
  </StudentPage>
}
