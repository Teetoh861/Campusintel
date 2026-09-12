// app/confirm-email/page.tsx — Rollout-gated confirm your email page.
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { ConfirmEmailForm } from './ConfirmEmailForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Confirm your email | CampusIntell', robots: { index: false, follow: false } }

/** Gate operational forms on the server; query parameters never carry credentials. */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; state?: string }> }) {
  const params = await searchParams
  const next = getSafeReturnPath(params.next)
  return <AuthShell title="Confirm your email">
    {isStudentAuthEnabled() ? <>
      
      <ConfirmEmailForm next={next} />
    </> : <AuthUnavailable />}
  </AuthShell>
}
