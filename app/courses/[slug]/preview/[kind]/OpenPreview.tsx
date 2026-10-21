'use client'
// app/courses/[slug]/preview/[kind]/OpenPreview.tsx — The one explicit step that spends the exam or the topic.
// Retrying after a lost response is safe: the server returns what it already pinned.
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { postDiscoveryCommand } from '@/lib/entitlements/client'
import type { DiscoveryCommand, DiscoveryResult } from '@/lib/entitlements/discovery-contract'
import type { ReactElement } from 'react'

type OpenCommand = Extract<DiscoveryCommand, { action: 'open' | 'open-topic' }>

const REFUSAL: Partial<Record<DiscoveryResult['status'], string>> = {
  'nothing-to-preview': 'This isn’t available on this course yet. Nothing was used, so you can choose another course.',
  'expired': 'Your Discovery Pass has ended.',
  'no-pass': 'You need a Discovery Pass to open this.',
  'used-elsewhere': 'You’ve already used this on another course.',
  'not-enough-time': 'There isn’t enough time left on your pass for the whole exam. Nothing was used.',
  'not-found': 'This course isn’t part of the Discovery Pass. Nothing was used.',
  'session-changed': 'You signed in on another tab. Refresh this page to continue.',
  'signed-out': 'You’ve been signed out. Sign in again to continue.',
}
const RETRY = 'We couldn’t open it. Nothing was used. Please try again.'

/** `confirm`, when given, asks once before spending: a mis-tap on a list must never use the only one. */
export function OpenPreview({ continuityToken, command, label, quiet = false, confirm }: {
  continuityToken: string; command: OpenCommand; label: string; quiet?: boolean; confirm?: string
}): ReactElement {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function open(): Promise<void> {
    setBusy(true)
    setMessage(null)
    const result = await postDiscoveryCommand(command, continuityToken)
    if (result.status === 'ready' || result.status === 'free-course' || result.status === 'full-access') {
      // The page re-reads the pinned material (or the course itself) on the server.
      router.refresh()
      return
    }
    setBusy(false)
    setMessage(REFUSAL[result.status] ?? RETRY)
  }

  if (confirming) return <div className="grid gap-2 rounded-lg border border-student-border p-3" role="group"
    aria-label={label}>
    <p className="text-sm text-student-text-primary">{confirm}</p>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={() => setConfirming(false)} disabled={busy}
        className={studentAction(btnGhost, 'bg-student-surface')}>Cancel</button>
      <button type="button" onClick={open} disabled={busy} className={studentAction(btnNavy, studentFocusDark)}>
        {busy ? 'Opening…' : 'Open it'}</button>
    </div>
    {message !== null && <p role="status" className="text-sm text-student-text-secondary">{message}</p>}
  </div>
  return <div className="grid gap-2">
    <button type="button" onClick={confirm === undefined ? open : () => setConfirming(true)} disabled={busy} className={quiet
      ? studentAction(btnGhost, 'bg-student-surface', 'w-full justify-start text-left')
      : studentAction(btnNavy, studentFocusDark, 'w-full tablet:w-auto')}>
      {busy ? 'Opening…' : label}
    </button>
    {message !== null && <p role="status" className="text-sm text-student-text-secondary">{message}</p>}
  </div>
}
