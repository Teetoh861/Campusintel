import { notFound, redirect } from 'next/navigation'
import { AuthUnavailable } from '@/components/auth/AuthShell'
import { StudentPage } from '@/components/student/StudentPage'
import { JoinPoster } from '@/components/orientation/JoinPoster'
import { getRenderedOperatorAccess } from '@/lib/operator/access'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Quiz joining poster | CampusIntell',robots: { index: false,follow: false } }
/** The printable link is public; creating the venue poster uses the ordinary operator guard. */
export default async function PosterPage() {
  const access = await getRenderedOperatorAccess()
  if (access.status === 'signed-out') redirect('/login?next=/admin')
  if (access.status === 'forbidden') notFound()
  if (access.status !== 'operator') return <AuthUnavailable />
  return <StudentPage><JoinPoster /></StudentPage>
}
