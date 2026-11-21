// lib/operator/access.ts — Live account and profile-role authorization for operator surfaces.
import 'server-only'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionUser } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import { getLiveSessionContext } from '@/lib/auth/mutation-context'
import type { LiveMutationContext } from '@/lib/auth/mutation-context'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import type { NextResponse } from 'next/server'

type OperatorClient = Awaited<ReturnType<typeof createClient>>

export type OperatorAccess =
  | { status: 'operator'; client: OperatorClient; userId: string }
  | { status: 'signed-out' | 'forbidden' | 'unavailable' }

async function authorizeClient(client: OperatorClient, userId: string): Promise<OperatorAccess> {
  const { data, error } = await client.from('profiles').select('role').eq('id', userId).maybeSingle()
  if (error || !data || (data.role !== 'student' && data.role !== 'operator')) return { status: 'unavailable' }
  return data.role === 'operator' ? { status: 'operator', client, userId } : { status: 'forbidden' }
}

/** Authorize an already-live mutation context separately from its rendered-session continuity. */
export async function authorizeOperatorContext(context: LiveMutationContext): Promise<OperatorAccess> {
  try { return await authorizeClient(context.client, context.user.id) }
  catch { return { status: 'unavailable' } }
}

/** Bind the operator workspace to the exact live session used to authorize its render. */
export async function getRenderedOperatorAccess(): Promise<
  (Extract<OperatorAccess, { status: 'operator' }> & { continuityToken: string })
  | Exclude<OperatorAccess, { status: 'operator' }>
> {
  const live = await getLiveSessionContext()
  if (live.status !== 'ready') return live
  const access = await authorizeOperatorContext(live.context)
  if (access.status !== 'operator') return access
  try {
    return { ...access, continuityToken: issueAccountContinuityToken(live.context.user.id, live.context.sessionId) }
  } catch { return { status: 'unavailable' } }
}

/** Use the ordinary HttpOnly Auth session, then read the current server-owned role. */
export async function getOperatorAccess(response?: NextResponse): Promise<OperatorAccess> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const user = await getStudentSessionUser(response, client)
    if (user === null) return { status: 'signed-out' }
    return await authorizeClient(client, user.id)
  } catch {
    return { status: 'unavailable' }
  }
}
