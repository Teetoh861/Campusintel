// app/register/page.tsx — Rollout-gated create an account page.
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { RegisterForm } from './RegisterForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create an account | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; state?: string }> }) {
  const params = await searchParams
  const next = getSafeReturnPath(params.next)
  return <AuthShell title="Create an account">
    {isStudentAuthEnabled() ? <>
      
      <RegisterForm next={next} />
    </> : <AuthUnavailable />}
  </AuthShell>
}
