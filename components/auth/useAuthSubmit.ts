// components/auth/useAuthSubmit.ts — Same-origin form submission without persistent client state.
'use client'
import { useRef, useState } from 'react'
import { AUTH_MESSAGES } from '@/lib/auth/constants'

type Result = { next?: string; message?: string }

/** Prevent concurrent submits and accept only the minimal application response. */
export function useAuthSubmit() {
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(endpoint: string, body: object): Promise<Result | null> {
    if (lock.current) return null
    lock.current = true
    setPending(true)
    setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const value: unknown = await response.json()
      if (!value || typeof value !== 'object') throw new Error('Invalid response')
      if (!response.ok) {
        setError('error' in value && typeof value.error === 'string' ? value.error : AUTH_MESSAGES.unavailable)
        return null
      }
      return {
        next: 'next' in value && typeof value.next === 'string' ? value.next : undefined,
        message: 'message' in value && typeof value.message === 'string' ? value.message : undefined,
      }
    } catch { setError(AUTH_MESSAGES.unavailable); return null }
    finally { lock.current = false; setPending(false) }
  }
  return { submit, pending, error }
}
