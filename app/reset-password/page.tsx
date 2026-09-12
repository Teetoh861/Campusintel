// app/reset-password/page.tsx — Rollout-gated reset password page.
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { ResetPasswordForm } from './ResetPasswordForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reset password | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
export default function Page() {
  return <AuthShell title="Reset password">
    {isStudentAuthEnabled() ? <>
      
      <ResetPasswordForm />
    </> : <AuthUnavailable />}
  </AuthShell>
}
