import 'server-only'
import { headers } from 'next/headers'
import { getSupabaseConfig, isStudentAuthEnabled } from '@/lib/auth/config'
import { orientationAccessToken } from './poll-session'
import { playerStateSchema } from './contract'

/** One HTTP database RPC, without SDK session lookup, refresh, getUser or an Auth request. */
export async function orientationPoll(host: boolean, eventId: string | null): Promise<{ status: number; value: unknown }> {
  if (!isStudentAuthEnabled()) return { status: 503, value: { message: 'The quiz is unavailable. Try again.' } }
  try {
    const { url, key } = getSupabaseConfig()
    const token = orientationAccessToken((await headers()).get('cookie'),url)
    if (token === null) return { status: 401, value: { message: 'Sign in to continue.' } }
    const response = await fetch(new URL(`/rest/v1/rpc/${host ? 'orientation_host_state' : 'orientation_poll'}`,url), {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(5_000),
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_event: eventId }),
    })
    if (response.ok) return { status: 200, value: await response.json() }
    if ([401,403].includes(response.status)) return { status: 401, value: { message: 'Sign in to continue.' } }
  } catch { /* Transport/provider details never enter player responses. */ }
  return { status: 503, value: { message: 'The quiz is unavailable. Try again.' } }
}

/** Initial private player projection for an already-gated server component. */
export async function initialPlayerState(eventId: string | null) {
  const result = await orientationPoll(false,eventId)
  const parsed = playerStateSchema.safeParse(result.value)
  return result.status === 200 && parsed.success ? parsed.data : null
}
