import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthUnavailableError, authUnavailable } from './unavailable'

export const AUTH_OUTBOUND_TIMEOUT_MS = 10_000
type CallStep = 'provider' | 'identity' | 'rate-limit'
const callSignal = new AsyncLocalStorage<AbortSignal>()

/** Bound the SDK call as well as its transport: SDK retries cannot extend the deadline. */
export async function authDeadline<T>(operation: (signal: AbortSignal) => PromiseLike<T>, step: CallStep): Promise<T> {
  const controller = new AbortController()
  const parent = callSignal.getStore()
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const failure = new AuthUnavailableError('timeout', 'Auth call timed out', step)
      reject(failure)
      controller.abort(failure)
    }, AUTH_OUTBOUND_TIMEOUT_MS)
  })
  try {
    if (signal.aborted) throw new AuthUnavailableError('timeout', 'Auth call timed out', step)
    return await Promise.race([timeout, callSignal.run(signal, () => Promise.resolve(operation(signal)))])
  } finally { clearTimeout(timer) }
}

/** Abort the network request and its body at the deadline; never pass raw transport errors to the SDK. */
export const authFetch: typeof fetch = (input, init) => authDeadline(async signal => {
  const supplied = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const combined = supplied ? AbortSignal.any([signal, supplied]) : signal
  try {
    const response = await fetch(input, { ...init, signal: combined })
    const body = response.body === null ? null : await response.arrayBuffer()
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch (error) {
    if (combined.aborted) throw new AuthUnavailableError('timeout', 'Auth call timed out', 'provider')
    throw authUnavailable(error, 'provider')
  }
}, 'provider')

const AUTH_RPCS = new Set(['read_account_lifecycle', 'read_student_context'])

/** Shared student clients also read course data: only auth transport gets this deadline here. */
export const studentAuthFetch: typeof fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  return callSignal.getStore() !== undefined || url.pathname.startsWith('/auth/v1/') || AUTH_RPCS.has(url.pathname.split('/').at(-1) ?? '')
    ? authFetch(input, init) : fetch(input, init)
}

/** Bind public session methods on this request-scoped client without changing SDK session/cookie semantics. */
export function bindStudentAuthDeadlines(auth: SupabaseClient['auth']): void {
  if (typeof auth.getUser === 'function') {
    const call = auth.getUser.bind(auth)
    auth.getUser = (...args) => authDeadline(() => call(...args), 'identity')
  }
  if (typeof auth.getClaims === 'function') {
    const call = auth.getClaims.bind(auth)
    auth.getClaims = (...args) => authDeadline(() => call(...args), 'identity')
  }
  if (typeof auth.getSession === 'function') {
    const call = auth.getSession.bind(auth)
    auth.getSession = (...args) => authDeadline(() => call(...args), 'identity')
  }
  if (typeof auth.setSession === 'function') {
    const call = auth.setSession.bind(auth)
    auth.setSession = (...args) => authDeadline(() => call(...args), 'identity')
  }
  if (typeof auth.signOut === 'function') {
    const call = auth.signOut.bind(auth)
    auth.signOut = (...args) => authDeadline(() => call(...args), 'identity')
  }
}
