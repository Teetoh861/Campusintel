// lib/auth/client-events.ts — Ephemeral cross-tab invalidation with no identity or credential payload.
'use client'
import { AUTH_STATUS_EVENT } from './constants'

let channel: BroadcastChannel | undefined
const listeners = new Set<() => void>()

/** Notify other documents through the same channel that this document listens on. */
export function notifyStudentChange(): void {
  let temporary: BroadcastChannel | undefined
  try {
    // BroadcastChannel excludes its sending instance. Reuse it to avoid reloading
    // this document before its successful login/reset navigation completes.
    const sender = channel ?? (temporary = new BroadcastChannel(AUTH_STATUS_EVENT))
    sender.postMessage('changed')
  } catch { /* Focus checks and server guards remain available without this browser feature. */ }
  finally { temporary?.close() }
}

/** Subscribe only to other-tab invalidation; never store or transmit student information. */
export function onStudentChange(refresh: () => void): () => void {
  try {
    if (!channel) {
      channel = new BroadcastChannel(AUTH_STATUS_EVENT)
      channel.onmessage = () => { for (const listener of listeners) listener() }
    }
    listeners.add(refresh)
    return () => {
      listeners.delete(refresh)
      if (!listeners.size) { channel?.close(); channel = undefined }
    }
  } catch { return () => {} }
}
