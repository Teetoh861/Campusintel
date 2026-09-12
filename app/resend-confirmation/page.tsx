// app/resend-confirmation/page.tsx — Rollout-gated resend confirmation page.
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { EmailForm } from '@/components/auth/EmailForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Resend confirmation | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
export default function Page() {
  return <AuthShell title="Resend confirmation">
    {isStudentAuthEnabled() ? <>
      
      <EmailForm />
    </> : <AuthUnavailable />}
  </AuthShell>
}
