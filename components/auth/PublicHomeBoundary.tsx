// components/auth/PublicHomeBoundary.tsx — Verified student Home redirect with an availability-safe public fallback.
import { redirect } from 'next/navigation'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { STUDENT_HOME_PATH } from '@/lib/auth/constants'
import type { ReactNode } from 'react'

/** Only a confirmed live session redirects; failed lookups preserve the marketing content. */
export async function PublicHomeBoundary({ children }: { children: ReactNode }): Promise<ReactNode> {
  if (!isStudentAuthEnabled()) return children
  let signedIn: boolean
  try { signedIn = await getStudentSessionContext() !== null }
  catch { return children }
  if (signedIn) redirect(STUDENT_HOME_PATH)
  return children
}
