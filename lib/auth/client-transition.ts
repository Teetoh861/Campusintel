'use client'
import { AUTH_API } from './constants'

export const STUDENT_AUTH_TRANSITION_LOCK = 'campusintell:student-auth-transition:v1'
const transitionEndpoints = new Set<string>([AUTH_API.login, AUTH_API.confirm, AUTH_API.reset, AUTH_API.logout])

/** One semantic family controls both origin-wide ordering and successful invalidation. */
export function isStudentAuthTransition(endpoint: string): boolean {
  return transitionEndpoints.has(endpoint)
}

/** Hold the cross-document lock through response processing, validation and notification.
 * Missing/failed coordination must never fall back to competing Set-Cookie responses.
 */
export async function runAuthTransition<T>(endpoint: string, operation: () => Promise<T>): Promise<T> {
  if (!isStudentAuthTransition(endpoint)) return operation()
  if (typeof navigator === 'undefined' || typeof navigator.locks?.request !== 'function') {
    throw new Error('Auth transition unavailable')
  }
  return navigator.locks.request(STUDENT_AUTH_TRANSITION_LOCK, { mode: 'exclusive' }, () => operation())
}
