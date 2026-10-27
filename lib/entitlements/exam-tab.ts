// lib/entitlements/exam-tab.ts — One browser tab's identity for an exam's save ledger, kept across reloads.
// Framework-free so the rules can be tested without a browser. The database applies one tab identity's saves in its own
// sequence order and accepts only so many identities per exam (Discovery Pass: discovery_exam_tabs; practice:
// practice_policy.attempt_tabs). A fresh identity on every mount would let reloads use that capacity up, so a tab keeps
// its identity and the last sequence it used in its own session storage, and a reload, an Exit and a later resume in
// the same tab carry on from them, above anything the database has applied. A duplicated tab copies that storage, so
// before reusing an identity the page asks every other open page of this site, over a broadcast channel, whether one
// still holds it: the reloaded page that used it is gone and nobody answers; the original of a duplicate answers, and
// the duplicate takes a new identity. Without a channel (or storage) nothing can be told apart, so a new identity is
// taken: never a shared one.
export type TabRecord = { tab: string; sequence: number }

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void }
type Channel = { postMessage(message: unknown): void; close(): void; onmessage: ((event: { data: unknown }) => void) | null }

export type ExamTabOptions = {
  /** One exam (or attempt): identities are never reused across exams. */
  key: string
  storage: Storage | null
  channel: ((name: string) => Channel) | null
  newId(): string
  schedule(run: () => void, ms: number): unknown
}

export type ExamTab = TabRecord & {
  /** Record the latest sequence this tab used, before the request carrying it is sent. */
  remember(sequence: number): void
  /** Stop answering for this identity (the page is going away). */
  release(): void
}

export const EXAM_TAB = {
  /** How long a page waits for another open page to say it holds the stored identity. */
  probeMs: 250,
  maxSequence: 1_000_000,
} as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function storageKey(key: string): string { return `exam-tab:${key}` }

/** Never trusted: a stored record is used only when it is a well-formed identity and sequence. */
export function readTabRecord(storage: Storage | null, key: string): TabRecord | null {
  if (storage === null) return null
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey(key)) ?? 'null')
    if (typeof value !== 'object' || value === null) return null
    const { tab, sequence } = value as Record<string, unknown>
    if (typeof tab !== 'string' || !UUID.test(tab) || typeof sequence !== 'number' || !Number.isSafeInteger(sequence) ||
        sequence < 0 || sequence > EXAM_TAB.maxSequence) return null
    return { tab: tab.toLowerCase(), sequence }
  } catch { return null }
}

function writeTabRecord(storage: Storage | null, key: string, record: TabRecord): void {
  try { storage?.setItem(storageKey(key), JSON.stringify(record)) } catch { /* Storage may be unavailable or full. */ }
}

type Message = { type: 'probe' | 'held'; tab: string; nonce: string }

function message(data: unknown): Message | null {
  if (typeof data !== 'object' || data === null) return null
  const { type, tab, nonce } = data as Record<string, unknown>
  return (type === 'probe' || type === 'held') && typeof tab === 'string' && typeof nonce === 'string'
    ? { type, tab, nonce } : null
}

/** Claim this tab's identity for one exam: the stored one when no other open page holds it, otherwise a new one. */
export async function claimExamTab(options: ExamTabOptions): Promise<ExamTab> {
  const stored = readTabRecord(options.storage, options.key)
  let channel: Channel | null = null
  try { channel = options.channel?.(`exam-tab:${options.key}`) ?? null } catch { channel = null }
  let mine: string | null = null
  let probing: Message | null = null
  let contested = false
  if (channel !== null) {
    const open = channel
    open.onmessage = event => {
      const incoming = message(event.data)
      if (incoming === null) return
      if (incoming.type === 'probe' && (incoming.tab === mine || (probing !== null && incoming.tab === probing.tab &&
          incoming.nonce !== probing.nonce))) {
        // Held here, or wanted here at the same moment: either way, the asking page must not reuse it.
        if (probing !== null && incoming.tab === probing.tab) contested = true
        open.postMessage({ type: 'held', tab: incoming.tab, nonce: incoming.nonce } satisfies Message)
      } else if (incoming.type === 'held' && probing !== null && incoming.nonce === probing.nonce) {
        contested = true
      }
    }
  }
  let record: TabRecord
  if (stored !== null && channel !== null && options.storage !== null) {
    probing = { type: 'probe', tab: stored.tab, nonce: options.newId() }
    channel.postMessage(probing)
    await new Promise<void>(resolve => { options.schedule(resolve, EXAM_TAB.probeMs) })
    record = contested ? { tab: options.newId().toLowerCase(), sequence: 0 } : stored
    probing = null
  } else {
    record = { tab: options.newId().toLowerCase(), sequence: 0 }
  }
  mine = record.tab
  writeTabRecord(options.storage, options.key, record)
  let sequence = record.sequence
  return {
    tab: record.tab,
    sequence: record.sequence,
    remember(next: number) {
      if (!Number.isSafeInteger(next) || next <= sequence) return
      sequence = next
      writeTabRecord(options.storage, options.key, { tab: record.tab, sequence })
    },
    release() {
      mine = null
      try { channel?.close() } catch { /* Already closed. */ }
    },
  }
}

const claims = new Map<string, Promise<ExamTab>>()

/**
 * One claim per exam for the life of this page, whatever mounts, remounts or re-runs ask for it (a second claim of the
 * same stored identity from the same page would look like a duplicated tab and take a new identity every time). The
 * identity is held, answering for it, until the page goes away.
 */
export function claimExamTabOnce(options: ExamTabOptions): Promise<ExamTab> {
  let claim = claims.get(options.key)
  if (claim === undefined) {
    claim = claimExamTab(options)
    claims.set(options.key, claim)
  }
  return claim
}

/** The browser's own storage and channel, each only when available. */
export function browserTabOptions(key: string): ExamTabOptions {
  let storage: Storage | null = null
  try { storage = window.sessionStorage } catch { storage = null }
  return {
    key, storage,
    channel: typeof BroadcastChannel === 'function' ? name => new BroadcastChannel(name) as unknown as Channel : null,
    newId: () => crypto.randomUUID(),
    schedule: (run, ms) => window.setTimeout(run, ms),
  }
}
