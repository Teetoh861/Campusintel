// app/reset-password/page.tsx — Rollout-gated reset password page.
import { SignedOutGate } from '@/components/auth/SignedOutGate'
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import Link from 'next/link'
import { AUTH_LINK } from '@/components/chrome/FormField'
import { AUTH_PATHS } from '@/lib/auth/constants'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reset password | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
function Content() {
  return <AuthShell title="Reset password">
    {isStudentAuthEnabled() ? <>

      <p>Start from Forgot password to request a reset code.</p>
      <Link href={AUTH_PATHS.forgot} className={AUTH_LINK}>Forgot password</Link>
    </> : <AuthUnavailable />}
  </AuthShell>
}

/** Apply the server session guard before rendering the identity-entry page. */
export default function Page() {
  return <SignedOutGate><Content /></SignedOutGate>
}
