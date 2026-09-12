// app/forgot-password/page.tsx — Rollout-gated forgot password page.
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { EmailForm } from '@/components/auth/EmailForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Forgot password | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
export default function Page() {
  return <AuthShell title="Forgot password">
    {isStudentAuthEnabled() ? <>
      
      <EmailForm recovery />
    </> : <AuthUnavailable />}
  </AuthShell>
}
