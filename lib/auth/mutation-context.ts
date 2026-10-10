import 'server-only'
import type { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isStudentAuthEnabled } from './config'
import { getStudentSessionContext } from './student-state'
import { matchesAccountContinuityToken } from './account-continuity'

export type LiveMutationContext = NonNullable<Awaited<ReturnType<typeof getStudentSessionContext>>> & {
  client: Awaited<ReturnType<typeof createClient>>
}
type SessionResult = { status: 'ready'; context: LiveMutationContext }
  | { status: 'signed-out'; client: Awaited<ReturnType<typeof createClient>> }
  | { status: 'unavailable' }
export type MutationContextResult = SessionResult | { status: 'session-changed' }

/** Establish the live cookie-bound identity on the client carrying this request's cookie changes.
 * A render may omit response; route callers must pass the response they finalize.
 * This establishes identity, not permission to perform a domain operation.
 */
export async function getLiveSessionContext(response?: NextResponse): Promise<SessionResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const session = await getStudentSessionContext(response, client)
    // Retain the request-scoped client so logout can clean conclusively invalid
    // residual credentials. Unexpected validation errors never reach this state.
    return session === null ? { status: 'signed-out', client } : { status: 'ready', context: { ...session, client } }
  } catch { return { status: 'unavailable' } }
}

/** Require the exact session that rendered the action; never infer the actor from client data. */
export async function getAuthenticatedMutationContext(
  response: NextResponse, renderedToken: string | null,
): Promise<MutationContextResult> {
  const live = await getLiveSessionContext(response)
  if (live.status !== 'ready') return live
  try {
    if (!renderedToken || !matchesAccountContinuityToken(renderedToken, live.context.user.id, live.context.sessionId)) {
      return { status: 'session-changed' }
    }
    return live
  } catch { return { status: 'unavailable' } }
}
