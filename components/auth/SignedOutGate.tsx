// components/auth/SignedOutGate.tsx — Server authorization for student identity-entry pages.
import { redirect } from 'next/navigation'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionUser } from '@/lib/auth/student-state'
import { AUTH_MESSAGES, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { createClient } from '@/lib/supabase/server'
import { readAccountLifecycle } from '@/lib/account/lifecycle'
import { ACCOUNT_DELETION_PATH } from '@/lib/account/constants'
import { Feedback } from '@/components/chrome/Feedback'
import { AuthFlowSync } from './AuthFlowSync'
import type { ReactNode } from 'react'

/** Keep disabled browsing intact and never render an entry flow over an existing identity. */
export async function SignedOutGate({ children }: { children: ReactNode }) {
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
  catch { return <Feedback message={AUTH_MESSAGES.unavailable} tone="error" /> }
  if (destination) redirect(destination)
  return <><AuthFlowSync />{children}</>
}
