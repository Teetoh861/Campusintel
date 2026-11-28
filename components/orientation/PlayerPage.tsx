import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { StudentPage } from '@/components/student/StudentPage'
import { initialPlayerState } from '@/lib/orientation/poll-server'
import { OrientationPhone } from './OrientationPhone'

async function PlayerGame({ eventId, token }: { eventId: string | null; token: string }) {
  return <div className="mx-auto max-w-xl"><OrientationPhone initial={await initialPlayerState(eventId)} eventId={eventId} token={token} /></div>
}
/** Use the normal verified-account and completed-profile guard, with no event exception. */
export function PlayerPage({ eventId = null }: { eventId?: string | null }) {
  const path = '/orientation' + (eventId ? '/' + eventId : '')
  return <StudentPage><StudentAccessGate returnPath={path}>{token => <PlayerGame eventId={eventId} token={token} />}</StudentAccessGate>
    <noscript><p>Open the quiz in Chrome or Safari.</p></noscript>
  </StudentPage>
}
