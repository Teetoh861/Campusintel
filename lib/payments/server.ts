// lib/payments/server.ts — Production wiring: the service-role database calls, the configured provider and the
// student's own session. Route handlers in routes.ts take these as dependencies so tests can supply their own.
import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import type { NextResponse } from 'next/server'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getAuthOrigin, getAuthSecretKey, getSupabaseConfig, isStudentAuthEnabled, isTrustedAuthOrigin } from '@/lib/auth/config'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import { readPaymentsConfig } from './config'
import { PaymentStoreError } from './rpc'
import { PAYMENT_DATABASE_TIMEOUT_MS, withPaymentTimeout } from './timeouts'
import type { PaymentRpc } from './rpc'
import type { RouteDeps, StudentSession } from './routes'

/** Service-role calls to part 1's payment functions. Errors carry the function name only, never row data. */
export function createServiceRpc(): PaymentRpc {
  const client = createServiceClient(getSupabaseConfig().url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return async (fn, args, options) => {
    const { data, error } = await withPaymentTimeout(signal => client.rpc(fn, args).abortSignal(signal),
      options?.timeoutMs ?? PAYMENT_DATABASE_TIMEOUT_MS, options?.signal)
    if (error) throw new PaymentStoreError(`${fn} refused (${error.code ?? 'unknown'})`)
    return data
  }
}

/** The signed-in student's live session, and a call to their own order through their RLS-bound client. */
async function resolveStudent(response: NextResponse, continuity: string | null): Promise<StudentSession | 'signed-out' | 'session-changed'> {
  if (!isStudentAuthEnabled()) return 'signed-out'
  const client = await createClient(response)
  const context = await getStudentSessionContext(response, client)
  if (context === null) return 'signed-out'
  if (continuity !== null && !matchesAccountContinuityToken(continuity, context.user.id, context.sessionId)) {
    return 'session-changed'
  }
  return { userId: context.user.id, sessionId: context.sessionId,
    readOwnOrder: async orderId => {
      const { data, error } = await withPaymentTimeout(signal =>
        client.rpc('get_my_payment_order', { p_order_id: orderId }).abortSignal(signal), PAYMENT_DATABASE_TIMEOUT_MS)
      if (error) throw new PaymentStoreError(`get_my_payment_order refused (${error.code ?? 'unknown'})`)
      return data
    } }
}

export function defaultRouteDeps(): RouteDeps {
  const config = readPaymentsConfig()
  return {
    rpc: createServiceRpc(),
    checkoutProvider: config.checkoutProvider,
    providerFor: config.providerFor,
    origin: getAuthOrigin(),
    resolveStudent,
    cronSecret: process.env.CRON_SECRET,
    isTrustedOrigin: isTrustedAuthOrigin,
  }
}
