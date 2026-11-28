// components/auth/SignedOutGate.tsx — Server authorization for student identity-entry pages.
import { redirect } from 'next/navigation'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionUser } from '@/lib/auth/student-state'
import { STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { createClient } from '@/lib/supabase/server'
import { readAccountLifecycle } from '@/lib/account/lifecycle'
import { ACCOUNT_DELETION_PATH } from '@/lib/account/constants'
import { Feedback } from '@/components/chrome/Feedback'
import { AuthFlowSync } from './AuthFlowSync'
import type { ReactNode } from 'react'
import { authUnavailableMessage, createAuthDiagnostic } from '@/lib/auth/unavailable'

/** Keep disabled browsing intact and never render an entry flow over an existing identity. */
export async function SignedOutGate({ children, route = '/auth' }: { children: ReactNode; route?: string }) {
  const diagnostic = createAuthDiagnostic(route)
  if (!isStudentAuthEnabled()) return children
  let destination: string | undefined
  try {
    const client = await createClient()
    const user = await getStudentSessionUser(undefined, client, { allowRestricted: true })
    if (user) {
      const lifecycle = await readAccountLifecycle(client)
      if (lifecycle.status !== 'signed-out') destination = lifecycle.status === 'active'
        ? STUDENT_HOME_PATH : ACCOUNT_DELETION_PATH
    }
  }
  catch (error) { return <Feedback message={authUnavailableMessage(route, error, diagnostic)} tone="error" /> }
  if (destination) redirect(destination)
  return <><AuthFlowSync />{children}</>
}
