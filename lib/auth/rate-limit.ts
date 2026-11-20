// lib/auth/rate-limit.ts — Purpose-separated HMAC buckets consumed by one privileged RPC.
import 'server-only'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { getAuthSecretKey, getSupabaseConfig } from './config'
import { AUTH_MESSAGES, RATE_LIMIT_POLICIES } from './constants'
import { readAuthInternalSecret } from './settings.cjs'
import { AuthRequestError } from './request'
import { AuthUnavailableError, authUnavailable, rateLimitUnavailable } from './unavailable'
import { authDeadline, authFetch } from './deadline'
import type { AuthAction } from './constants'

/** The keyed bucket name for one action, purpose and value; the raw email or address never leaves the server. */
export function getBucket(action: AuthAction | 'DISCOVERY_ACTIVATION', purpose: 'account' | 'origin', value: string): string {
  const secret = readAuthInternalSecret({ AUTH_INTERNAL_SECRET: process.env.AUTH_INTERNAL_SECRET },
    () => new AuthUnavailableError('configuration', 'Auth configuration unavailable'))
  return createHmac('sha256', secret).update(JSON.stringify(['campusintell:auth-rate-limit:v1', action, purpose, value])).digest('hex')
}

/** Atomically consume both policies. Raw email/address never enters the database. */
export async function consumeAuthLimit(action: AuthAction, email: string, address: string): Promise<void> {
  const policy = RATE_LIMIT_POLICIES[action]
  const { url } = getSupabaseConfig()
  const client = createClient(url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: authFetch },
  })
  const parameters = {
    p_action: action, p_account: getBucket(action, 'account', email), p_origin: getBucket(action, 'origin', address),
    p_account_limit: policy.account[0], p_account_window: policy.account[1],
    p_origin_limit: policy.origin[0], p_origin_window: policy.origin[1],
  }
  const { data, error } = await authDeadline(() => client.rpc('consume_auth_rate_limit', parameters), 'rate-limit').catch(error => {
    throw authUnavailable(error, 'rate-limit')
  })
  if (error || typeof data !== 'boolean') throw rateLimitUnavailable(error?.code)
  if (!data) throw new AuthRequestError(429, AUTH_MESSAGES.limited)
}
