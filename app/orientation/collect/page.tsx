import Link from 'next/link'
import { AuthUnavailable } from '@/components/auth/AuthShell'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { StudentPage } from '@/components/student/StudentPage'
import { StaffCollection } from '@/components/orientation/StaffCollection'
import { quizButton } from '@/components/orientation/parts'
import { getLiveSessionContext } from '@/lib/auth/mutation-context'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { staffEventsSchema } from '@/lib/orientation/contract'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Prize collection | CampusIntell',robots: { index: false,follow: false } }
/** Authorize event membership on the server without granting staff an operator role. */
export default async function StaffPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const access = await getLiveSessionContext()
  if (access.status === 'signed-out') return <StudentPage><div className="grid gap-4"><h1 className="text-2xl font-bold">Sign in to continue</h1><Link className={quizButton} href="/login?next=/orientation/collect">Sign in</Link></div></StudentPage>
  if (access.status !== 'ready') return <AuthUnavailable />
  const { data,error } = await access.context.client.rpc('orientation_staff_events')
  const parsed = staffEventsSchema.safeParse(data)
  if (error || !parsed.success) return <AuthUnavailable />
  if (!parsed.data.events.length) return <StudentPage><h1 className="text-2xl font-bold">Staff access required</h1><p className="mt-4">Ask the host to add your account.</p></StudentPage>
  const { event } = await searchParams
  const selected = parsed.data.events.find(item => item.id === event)?.id ?? parsed.data.events[0].id
  const token = issueAccountContinuityToken(access.context.user.id,access.context.sessionId)
  return <><AuthFlowSync signedIn continuityToken={token} /><StudentPage><div className="mx-auto max-w-xl"><StaffCollection events={parsed.data.events} initialEvent={selected} token={token} /></div></StudentPage></>
}
