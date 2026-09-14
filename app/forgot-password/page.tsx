// app/forgot-password/page.tsx — Rollout-gated forgot password page.
import { SignedOutGate } from '@/components/auth/SignedOutGate'
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { RecoveryFlow } from './RecoveryFlow'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Forgot password | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
function Content() {
  return isStudentAuthEnabled() ? <RecoveryFlow /> :
    <AuthShell title="Forgot password"><AuthUnavailable /></AuthShell>
}

/** Apply the server session guard before rendering the identity-entry page. */
export default function Page() {
  return <SignedOutGate><Content /></SignedOutGate>
}
