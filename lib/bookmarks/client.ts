// lib/bookmarks/client.ts — Browser transport and shared bookmark subscriptions.
'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { onStudentChange } from '@/lib/auth/client-events'
import { BOOKMARK_STORAGE_KEY } from './local'
import { BookmarkStore } from './store'
import type { BookmarkAccountResult, BookmarkCourseAlias, BookmarkCourseIdentity } from './contract'
import type { BookmarkSnapshot } from './store'

const ACCOUNT_CHANGE_CHANNEL = 'ci:account-bookmarks-changed'
const UUID_FORMAT = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

async function parseResult(response: Response): Promise<BookmarkAccountResult> {
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 'unavailable' }
  const data = body as Record<string, unknown>
  if (data.status === 'signed-out' || data.status === 'session-changed') return { status: data.status }
  if (!response.ok || data.status !== 'ready' || !Array.isArray(data.courseKeys) ||
      !data.courseKeys.every(key => typeof key === 'string') ||
      typeof data.continuityToken !== 'string' || typeof data.ownerMarker !== 'string') {
    return { status: 'unavailable' }
  }
  let courseIds: BookmarkCourseIdentity[] | undefined
  if (data.courseIds !== undefined) {
    if (!Array.isArray(data.courseIds)) return { status: 'unavailable' }
    courseIds = []
    for (const item of data.courseIds) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return { status: 'unavailable' }
      const identity = item as Record<string, unknown>
      if (typeof identity.contentKey !== 'string' || typeof identity.courseId !== 'string' ||
          !UUID_FORMAT.test(identity.courseId)) return { status: 'unavailable' }
      courseIds.push({ contentKey: identity.contentKey, courseId: identity.courseId })
    }
  }
  return { status: 'ready', courseKeys: data.courseKeys,
    continuityToken: data.continuityToken, ownerMarker: data.ownerMarker,
    ...(courseIds ? { courseIds } : {}) }
}

const transport = {
  async read(): Promise<BookmarkAccountResult> {
    const response = await fetch('/api/bookmarks', { cache: 'no-store', credentials: 'same-origin' })
    return parseResult(response)
  },
  async verify(token: string): Promise<'same' | 'changed' | 'unavailable'> {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin',
        headers: { [AUTH_CONTINUITY_HEADER]: token } })
      if (!response.ok) return 'unavailable'
      const body: unknown = await response.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) return 'unavailable'
      const status = body as Record<string, unknown>
      return status.enabled === true && status.signedIn === true && status.sameAccount === true
        ? 'same' : status.enabled === true && status.sameAccount === false ? 'changed' : 'unavailable'
    } catch { return 'unavailable' }
  },
  async write(command: { action: 'merge'; reconciliationId: string; courseIds: string[] } |
      { action: 'add' | 'remove'; contentKey: string }, token: string): Promise<BookmarkAccountResult> {
    const response = await fetch('/api/bookmarks', {
      method: 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: token },
      body: JSON.stringify(command),
    })
    return parseResult(response)
  },
}

let channel: BroadcastChannel | null = null
// Bookmark controls render only on account-gated pages; session loss must never
// downgrade them into anonymous device bookmarking.
const bookmarks = new BookmarkStore(() => window.localStorage, transport, () => {
  try { channel?.postMessage('changed') }
  catch { /* Focus refresh still observes the durable state. */ }
}, 'closed')
let listenersAttached = false

function attachBrowserListeners(): void {
  if (listenersAttached) return
  listenersAttached = true
  window.addEventListener('storage', event => {
    if (event.key === BOOKMARK_STORAGE_KEY || event.key === null) bookmarks.onAnonymousStorageChange()
  })
  window.addEventListener('focus', () => { void bookmarks.refresh() })
  window.addEventListener('pageshow', event => { if (event.persisted) void bookmarks.refresh() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void bookmarks.refresh()
  })
  onStudentChange(() => { void bookmarks.refresh() })
  try {
    channel = new BroadcastChannel(ACCOUNT_CHANGE_CHANNEL)
    channel.onmessage = () => { void bookmarks.refresh() }
  } catch { /* Focus refresh remains available. */ }
}

/** Share one live bookmark state across both page controls and the saved grid. */
export function useBookmarks(catalog: ReadonlyArray<BookmarkCourseAlias>): {
  snapshot: BookmarkSnapshot
  toggle: (course: BookmarkCourseAlias) => Promise<'added' | 'removed' | null>
  remove: (course: BookmarkCourseAlias) => Promise<boolean>
  refresh: (retry?: number) => Promise<void>
} {
  const snapshot = useSyncExternalStore(bookmarks.subscribe, bookmarks.getSnapshot, bookmarks.getServerSnapshot)
  useEffect(() => {
    bookmarks.configure(catalog)
    attachBrowserListeners()
    bookmarks.ensureLoaded()
  }, [catalog])
  return { snapshot, toggle: bookmarks.toggle.bind(bookmarks),
    remove: bookmarks.remove.bind(bookmarks), refresh: bookmarks.refresh.bind(bookmarks) }
}
