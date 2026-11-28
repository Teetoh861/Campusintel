import { notFound, redirect } from 'next/navigation'
import { getRenderedOperatorAccess } from '@/lib/operator/access'
import { AuthUnavailable } from '@/components/auth/AuthShell'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { StudentPage } from '@/components/student/StudentPage'
import { OrientationHost } from '@/components/orientation/OrientationHost'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orientation quiz host | CampusIntell', robots: { index: false, follow: false } }
export default async function HostPage() {
  const access = await getRenderedOperatorAccess()
  if (access.status === 'signed-out') redirect('/login?next=/admin')
  if (access.status === 'forbidden') notFound()
  if (access.status !== 'operator') return <AuthUnavailable />
  return <><AuthFlowSync signedIn continuityToken={access.continuityToken} /><StudentPage>
    <OrientationHost token={access.continuityToken} />
  </StudentPage></>
}
