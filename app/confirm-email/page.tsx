// app/confirm-email/page.tsx — Recover confirmation context without accepting an email from the URL.
import Link from 'next/link'
import { SignedOutGate } from '@/components/auth/SignedOutGate'
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { AUTH_LINK } from '@/components/chrome/FormField'
import { AUTH_PATHS } from '@/lib/auth/constants'
import { isStudentAuthEnabled } from '@/lib/auth/config'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Check your email | CampusIntell', robots: { index: false, follow: false } }

/** Direct visits cannot reconstruct the email held by a registration or login flow. */
function Content() {
  return <AuthShell title="Check your email">
    {isStudentAuthEnabled() ? <>
      <p>Start from sign up or sign in to request a confirmation code.</p>
      <div className="flex flex-wrap gap-4">
        <Link href={AUTH_PATHS.register} className={AUTH_LINK}>Create account</Link>
        <Link href={AUTH_PATHS.login} className={AUTH_LINK}>Sign in</Link>
      </div>
    </> : <AuthUnavailable />}
  </AuthShell>
}

/** Apply the server session guard before rendering the identity-entry page. */
export default function Page() {
  return <SignedOutGate><Content /></SignedOutGate>
}
