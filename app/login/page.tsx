// app/login/page.tsx — Rollout-gated sign in page.
import { SignedOutGate } from '@/components/auth/SignedOutGate'
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { Feedback } from '@/components/chrome/Feedback'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { PASSWORD_RESET_STATE, AUTH_MESSAGES } from '@/lib/auth/constants'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
async function Content({ searchParams }: { searchParams: Promise<{ next?: string; state?: string }> }) {
  const params = await searchParams
  const next = getSafeReturnPath(params.next)
  return <AuthShell title="Sign in">
    {isStudentAuthEnabled() ? <>
      {params.state === PASSWORD_RESET_STATE && <Feedback message={AUTH_MESSAGES.resetSuccess} tone="success" />}
      <LoginForm next={next} />
    </> : <AuthUnavailable />}
  </AuthShell>
}

/** Apply the server session guard before rendering the identity-entry page. */
export default function Page(props: Parameters<typeof Content>[0]) {
  return <SignedOutGate><Content {...props} /></SignedOutGate>
}
