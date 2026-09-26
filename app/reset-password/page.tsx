// app/reset-password/page.tsx — Rollout-gated reset password page.
import { SignedOutGate } from '@/components/auth/SignedOutGate'
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import Link from 'next/link'
import { AuthSecondaryActions } from '@/components/auth/AuthFormLayout'
import { btnBase, btnNavy, btnSm, cx, focusRingNavy } from '@/components/chrome/ui'
import { AUTH_PATHS } from '@/lib/auth/constants'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reset password | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
function Content() {
  return <AuthShell title="Reset password">
    {isStudentAuthEnabled() ? <>

      <p>Start from Forgot password to request a reset code.</p>
      <AuthSecondaryActions><Link href={AUTH_PATHS.forgot} className={cx(btnBase, btnSm, btnNavy, focusRingNavy)}>Forgot password</Link></AuthSecondaryActions>
    </> : <AuthUnavailable />}
  </AuthShell>
}

/** Apply the server session guard before rendering the identity-entry page. */
export default function Page() {
  return <SignedOutGate><Content /></SignedOutGate>
}
