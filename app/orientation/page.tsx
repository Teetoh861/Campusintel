import { PlayerPage } from '@/components/orientation/PlayerPage'
import { PinHandoff } from '@/components/orientation/PinHandoff'
import { SignedOut } from '@/components/orientation/parts'
import { StudentPage } from '@/components/student/StudentPage'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orientation quiz | CampusIntell', robots: { index: false, follow: false } }
/** Public QR entry discloses no game data; the full game retains the normal account/setup guard. */
export default async function OrientationPage() {
  if (isStudentAuthEnabled()) {
    try {
      if (await getStudentSessionContext() === null) return <StudentPage><div className="mx-auto max-w-xl"><PinHandoff /><SignedOut /></div></StudentPage>
    } catch { /* The standard gate renders its neutral unavailable state. */ }
  }
  return <PlayerPage />
}
