// lib/auth/client-events.ts — Ephemeral cross-tab invalidation with no identity or credential payload.
'use client'
import { AUTH_STATUS_EVENT } from './constants'

/** Optional browser coordination must never turn a completed auth operation into a failure. */
export function notifyStudentChange(): void {
  let channel: BroadcastChannel | undefined
  try {
    channel = new BroadcastChannel(AUTH_STATUS_EVENT)
    channel.postMessage('changed')
  } catch { /* Focus checks and server guards remain available without this browser feature. */ }
  finally { channel?.close() }
}

/** Subscribe only to invalidation; do not store or transmit student information. */
export function onStudentChange(refresh: () => void): () => void {
  try {
    const channel = new BroadcastChannel(AUTH_STATUS_EVENT)
    channel.onmessage = refresh
    return () => channel.close()
  } catch { return () => {} }
}
