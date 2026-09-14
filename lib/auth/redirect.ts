// lib/auth/redirect.ts — Restrict return destinations to credential-free application paths.
import { AUTH_PATHS, DEFAULT_AUTH_REDIRECT, AUTH_RETURN_PATH_MAX_LENGTH } from './constants'

/** Validate an internal pathname. Queries/fragments are deliberately not propagated. */
export function getSafeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > AUTH_RETURN_PATH_MAX_LENGTH ||
      !/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(value)) return DEFAULT_AUTH_REDIRECT
  const path = value.replace(/\/+$/, '') || '/'
  if (/^\/(api|admin|auth)(\/|$)/i.test(path) ||
      Object.values(AUTH_PATHS).some(auth => auth !== AUTH_PATHS.account &&
        (path.toLowerCase() === auth || path.toLowerCase().startsWith(auth + '/')))) {
    return DEFAULT_AUTH_REDIRECT
  }
  return path
}
