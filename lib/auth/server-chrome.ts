import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { readAccountLifecycle } from '@/lib/account/lifecycle'
import { ACCOUNT_DELETION_PATH } from '@/lib/account/constants'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionContext } from './student-state'
import { CHROME_STATE_HEADER, STUDENT_RENDER_PATH_HEADER, parseChromeState } from './chrome-state'
import type { ChromeState } from './chrome-state'

/** Share verified page identity with the gate and header; preserve the lifecycle decision redirect. */
export async function readStudentChromeState(): Promise<ChromeState> {
  const requestHeaders = await headers()
  // Non-GETs and refresh-only callers keep the proxy's presentation contract.
  const path = requestHeaders.get(STUDENT_RENDER_PATH_HEADER)
  if (path === null) return parseChromeState(requestHeaders.get(CHROME_STATE_HEADER))
  if (!isStudentAuthEnabled()) return 'signed-out'
  let restricted = false
  let chrome: ChromeState
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client, { allowRestricted: true })
    if (context === null) return 'signed-out'
    const lifecycle = await readAccountLifecycle(client)
    restricted = lifecycle.status === 'scheduled' || lifecycle.status === 'expired'
    chrome = lifecycle.status === 'signed-out' ? 'signed-out' : 'signed-in'
  } catch { return 'unknown' }
  // Outside the catch: a Next redirect is a control-flow exception.
  if (restricted && path !== ACCOUNT_DELETION_PATH) redirect(ACCOUNT_DELETION_PATH)
  return chrome
}
