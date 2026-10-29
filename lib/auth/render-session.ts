// Read-only page snapshot. React owns its lifetime: neither identity nor profile is cached across requests.
import 'server-only'
import { cache } from 'react'
import { z } from 'zod'
import { lifecycleSchema } from '@/lib/account/lifecycle-contract'
import { readVerifiedStudentUser } from './verified-user'
import type { StudentClient } from '@/lib/supabase/server'

// Only the no-response render-client factory opts in. Explicit mutation/refresh clients keep fresh checks.
const renderClients = new WeakSet<StudentClient>()
const snapshotSchema = z.object({
  user_id: z.string().uuid(), session_id: z.string().uuid(), lifecycle: lifecycleSchema,
  // Profile/reference failures must not turn a verified account into a visitor. The profile domain validates these.
  profile: z.unknown(), references: z.unknown(),
}).strict()

/** Register a read-only client created inside the React request cache. */
export function registerStudentRenderClient(client: StudentClient): StudentClient {
  renderClients.add(client)
  return client
}

/** Caller-provided and mutation clients deliberately retain fresh validation. */
export function isStudentRenderClient(client: StudentClient): boolean {
  return renderClients.has(client)
}

/** One remote identity check alongside one caller-only database snapshot, shared by the entire render. */
export const readRenderStudentSession = cache(async (client: StudentClient) => {
  // The local session supplies transport only. Never take identity from its user object. Passing the cookie JWT
  // explicitly to Auth avoids the SDK session mutex serializing the independent caller-only database read.
  const transport = await client.auth.getSession()
  const jwt = transport.data.session?.access_token
  if (transport.error || !jwt) {
    if (await readVerifiedStudentUser(client) === null) return null
    throw new Error('Session validation failed')
  }
  const [user, { data: claimsData, error: claimsError }, { data, error }] = await Promise.all([
    readVerifiedStudentUser(client, jwt), client.auth.getClaims(jwt), client.rpc('read_student_context'),
  ])
  if (user === null) return null
  if (error?.code === '42501') return null
  if (error) throw new Error('Student context unavailable')
  const claims = claimsData?.claims
  if (claimsError || claims?.sub !== user.id || typeof claims.session_id !== 'string' || !claims.session_id) {
    throw new Error('Session validation failed')
  }
  const snapshot = snapshotSchema.parse(data)
  if (snapshot.user_id !== user.id || snapshot.session_id !== claims.session_id) throw new Error('Session validation failed')
  if (snapshot.lifecycle.status === 'signed-out') return null
  return { user, sessionId: claims.session_id, snapshot }
})
