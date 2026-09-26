// lib/auth/rate-limit.ts — Purpose-separated HMAC buckets consumed by one privileged RPC.
import 'server-only'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { getAuthSecretKey, getSupabaseConfig } from './config'
import { AUTH_MESSAGES, RATE_LIMIT_POLICIES, AUTH_INTERNAL_SECRET_MIN_BYTES } from './constants'
import { AuthRequestError } from './request'
import type { AuthAction } from './constants'

function getBucket(action: AuthAction, purpose: 'account' | 'origin', value: string): string {
  const secret = process.env.AUTH_INTERNAL_SECRET
  if (!secret || Buffer.byteLength(secret) < AUTH_INTERNAL_SECRET_MIN_BYTES) throw new Error('Auth configuration unavailable')
  return createHmac('sha256', secret).update(JSON.stringify(['campusintell:auth-rate-limit:v1', action, purpose, value])).digest('hex')
}

/** Atomically consume both policies. Raw email/address never enters the database. */
export async function consumeAuthLimit(action: AuthAction, email: string, address: string): Promise<void> {
  const policy = RATE_LIMIT_POLICIES[action]
  const { url } = getSupabaseConfig()
  const client = createClient(url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await client.rpc('consume_auth_rate_limit', {
    p_action: action, p_account: getBucket(action, 'account', email), p_origin: getBucket(action, 'origin', address),
    p_account_limit: policy.account[0], p_account_window: policy.account[1],
    p_origin_limit: policy.origin[0], p_origin_window: policy.origin[1],
  })
  if (error || typeof data !== 'boolean') throw new Error('Auth rate limit unavailable')
  if (!data) throw new AuthRequestError(429, AUTH_MESSAGES.limited)
}
