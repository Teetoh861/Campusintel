// lib/auth/recovery-grant.ts — Issue/consume private recovery grants through narrowly scoped RPCs.
import 'server-only'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import type { NextResponse } from 'next/server'
import { getAuthSecretKey, getSupabaseConfig } from './config'
import { isRecoveryCredential, recoveryDigest, makeRecoveryGrant,
  RECOVERY_GRANT_COOKIE, RECOVERY_GRANT_PATH, RECOVERY_GRANT_LIFETIME_SECONDS, type RecoveryIdentity } from './recovery-crypto'

function store() {
  const { url } = getSupabaseConfig()
  // This private client exposes no general-purpose data layer; only the two grant RPCs are used.
  return createClient(url, getAuthSecretKey(), { auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  } })
}

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: RECOVERY_GRANT_PATH }
}

/** Clear only after a matching flow was claimed, or explicit global invalidation. */
export function clearRecoveryCookie(response: NextResponse): void {
  response.cookies.set(RECOVERY_GRANT_COOKIE, '', { ...cookieOptions(), maxAge: 0, expires: new Date(0) })
}

async function takeIdentity(binding: string | null): Promise<{ userId: string } | null> {
  const credential = (await cookies()).get(RECOVERY_GRANT_COOKIE)?.value
  if (!isRecoveryCredential(credential)) return null
  const { data, error } = await store().rpc('consume_recovery_grant', {
    p_hash: recoveryDigest(credential, 'credential'), p_binding: binding,
  })
  if (error) throw new Error('Recovery store unavailable')
  if (data === null) return null
  return { userId: z.string().uuid().parse(data) }
}

/** Logout owns the browser's current authorization, regardless of recovery flow. */
export async function discardCurrentRecoveryGrant(): Promise<void> {
  await takeIdentity(null)
}

/** Discard only this email's flow; true proves a matching live credential was claimed.
 * Null/expired/unknown results do not prove cookie ownership and must not clear it.
 */
export async function discardRecoveryGrantForFlow(email: string): Promise<boolean> {
  return (await takeIdentity(recoveryDigest(email, 'flow'))) !== null
}

/** Mint only after server verification; the response receives a random opaque credential, never tokens. */
export async function issueRecoveryGrant(identity: RecoveryIdentity, response: NextResponse): Promise<void> {
  const grant = makeRecoveryGrant(identity)
  const { error } = await store().rpc('issue_recovery_grant', {
    p_hash: grant.hash, p_user_id: grant.userId, p_binding: grant.binding,
  })
  if (error) throw new Error('Recovery store unavailable')
  response.cookies.set(RECOVERY_GRANT_COOKIE, grant.credential, { ...cookieOptions(), maxAge: RECOVERY_GRANT_LIFETIME_SECONDS })
}

/** Consume before changing a password; bind the request to the verified flow's email and identity. */
export async function consumeRecoveryGrant(email: string): Promise<{ userId: string } | null> {
  return takeIdentity(recoveryDigest(email, 'flow'))
}
