// Cookie decoding is transport only. PostgREST verifies the JWT; the RPC checks live Auth/session/profile state.
import 'server-only'
import { z } from 'zod'
import { resolveStudentSessionNamespaceFromCookieHeader } from '@/lib/auth/session-generation'

const stored = z.object({ access_token: z.string().max(16_384).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/) })
const MAX_COOKIE_CHUNKS = 8
/** Read only the selected SSR cookie generation; malformed/partial/ambiguous cookies fail closed. */
export function orientationAccessToken(rawCookie: string | null, projectUrl: string): string | null {
  const namespace = resolveStudentSessionNamespaceFromCookieHeader(rawCookie)
  if (namespace.mode === 'invalid') return null
  const root = namespace.storageName ?? `sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token`
  const jar = new Map<string,string>()
  for (const raw of (rawCookie ?? '').split(';')) {
    const pair = raw.trim(), index = pair.indexOf('=')
    if (index < 0) continue
    const name = pair.slice(0,index), value = pair.slice(index + 1)
    if (name !== root && !name.startsWith(root + '.')) continue
    if (jar.has(name)) return null
    jar.set(name,value)
  }
  let value = jar.get(root)
  if (value !== undefined && jar.size !== 1) return null
  if (value === undefined) {
    if (!jar.size || jar.size > MAX_COOKIE_CHUNKS) return null
    value = ''
    for (let i = 0; i < jar.size; i++) {
      const chunk = jar.get(`${root}.${i}`)
      if (chunk === undefined) return null
      value += chunk
    }
  }
  if (value.length > 32_768) return null
  try {
    const decoded = value.startsWith('base64-') ? Buffer.from(value.slice(7),'base64url').toString('utf8') : decodeURIComponent(value)
    return stored.parse(JSON.parse(decoded)).access_token
  } catch { return null }
}
