// app/account/page.tsx — Minimal server-authorized student account, without Phase B profile editing.
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { redirect } from 'next/navigation'
import { AuthShell, AuthUnavailable } from '@/components/auth/AuthShell'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { AUTH_PATHS, AUTH_MESSAGES } from '@/lib/auth/constants'
import { Feedback } from '@/components/chrome/Feedback'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Account | CampusIntell', robots: { index: false, follow: false } }

/** Authenticate on the server; only the email is rendered, never a serialized User object. */
export default async function AccountPage() {
  if (!isStudentAuthEnabled()) return <AuthShell title="Account"><AuthUnavailable /></AuthShell>
  let email: string | undefined
  try {
    const client = await createClient()
    const { data, error } = await client.auth.getUser()
    if (error && error.name !== 'AuthSessionMissingError') throw new Error('Session lookup failed')
    email = data.user?.email
    if (data.user !== null && (error || typeof email !== 'string' || !email)) throw new Error('Student identity missing')
  } catch { return <AuthShell title="Account"><Feedback message={AUTH_MESSAGES.unavailable} tone="error" /></AuthShell> }
  if (!email) redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(AUTH_PATHS.account))
  return <AuthShell title="Account"><AuthFlowSync signedIn /><p className="break-words">Signed in as {email}</p><LogoutButton /></AuthShell>
}
