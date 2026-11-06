// lib/auth/redirect.ts — Restrict return destinations to credential-free application paths.
import { AUTH_PATHS, DEFAULT_AUTH_REDIRECT, AUTH_RETURN_PATH_MAX_LENGTH, OPERATOR_HOME_PATH } from './constants'

// The only return paths that keep a query string: one fixed parameter with a strictly shaped value each (a practice result,
// Confirm courses for a plan, the payment return page). Every other query string is refused as before.
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RETURN_PATHS_WITH_QUERY = [
  new RegExp(`^/courses/[a-z0-9]+(?:-[a-z0-9]+)*/quiz\\?attempt=${UUID_PATTERN}$`),
  /^\/access\/checkout\?plan=(?:standard|plus)_(?:semester|session)$/,
  new RegExp(`^/access/checkout/return\\?order=${UUID_PATTERN}$`),
]

/** Validate an internal pathname. Queries and fragments are not propagated, except the three fixed forms above. */
export function getSafeReturnPath(value: unknown): string {
  if (typeof value === 'string' && RETURN_PATHS_WITH_QUERY.some(pattern => pattern.test(value))) return value
  if (typeof value !== 'string' || value.length > AUTH_RETURN_PATH_MAX_LENGTH ||
      !/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(value)) return DEFAULT_AUTH_REDIRECT
  const path = value.replace(/\/+$/, '') || '/'
  // The operator landing page applies its own live role check after sign-in.
  if (path === OPERATOR_HOME_PATH) return path
  if (/^\/(api|admin|auth)(\/|$)/i.test(path) ||
      Object.values(AUTH_PATHS).some(auth => auth !== AUTH_PATHS.account &&
        (path.toLowerCase() === auth || path.toLowerCase().startsWith(auth + '/')))) {
    return DEFAULT_AUTH_REDIRECT
  }
  return path
}
