// app/register/page.tsx — Rollout-gated create an account page.
import { SignedOutGate } from '@/components/auth/SignedOutGate'
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { RegisterForm } from './RegisterForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create account | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
async function Content({ searchParams }: { searchParams: Promise<{ next?: string; state?: string }> }) {
  const params = await searchParams
  const next = getSafeReturnPath(params.next)
  return <AuthShell title="Create account">
    {isStudentAuthEnabled() ? <>

      <RegisterForm next={next} />
    </> : <AuthUnavailable />}
  </AuthShell>
}

/** Apply the server session guard before rendering the identity-entry page. */
export default function Page(props: Parameters<typeof Content>[0]) {
  return <SignedOutGate><Content {...props} /></SignedOutGate>
}
