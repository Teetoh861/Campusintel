// app/login/page.tsx — Rollout-gated sign in page.
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { AuthNotice } from '@/components/auth/AuthNotice'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { PASSWORD_RESET_STATE } from '@/lib/auth/constants'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; state?: string }> }) {
  const params = await searchParams
  const next = getSafeReturnPath(params.next)
  return <AuthShell title="Sign in">
    {isStudentAuthEnabled() ? <>
      {params.state === PASSWORD_RESET_STATE && <AuthNotice message="Password reset completed. Sign in with your new password." />}
      <LoginForm next={next} />
    </> : <AuthUnavailable />}
  </AuthShell>
}
