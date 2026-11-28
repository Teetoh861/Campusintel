import 'server-only'

const INVALID_CREDENTIAL_CODES = new Set(['bad_jwt', 'refresh_token_not_found', 'refresh_token_already_used',
  'session_expired', 'session_not_found', 'user_not_found', 'user_banned'])
const cleanups = new WeakMap<object, () => void>()

/** These provider answers confirm invalid credentials; a transport or ambiguous failure never does. */
export function isInvalidStudentCredential(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return ('name' in error && error.name === 'AuthSessionMissingError') ||
    ('code' in error && typeof error.code === 'string' && INVALID_CREDENTIAL_CODES.has(error.code))
}

/** The cookie adapter owns which namespace may be cleared and where its writes are persisted. */
export function registerInvalidSessionCleanup<T extends object>(client: T, cleanup: () => void): T {
  cleanups.set(client, cleanup)
  return client
}

/** Clear only the active namespace; never erase unrelated or newer student cookies. */
export function clearInvalidStudentSession(client: object): void { cleanups.get(client)?.() }

/** Names supplied by the SDK adapter, including its numbered chunks. The selector must remain to prevent legacy fallback. */
export function isActiveStudentAuthCookie(name: string, storageName: string): boolean {
  return name === storageName || (name.startsWith(`${storageName}.`) && /^(?:0|[1-9][0-9]*)$/.test(name.slice(storageName.length + 1)))
}
