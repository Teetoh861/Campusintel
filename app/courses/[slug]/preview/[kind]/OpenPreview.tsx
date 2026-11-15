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
  'expired': 'Your free pass has ended.',
  'no-pass': 'You need a free pass to open this.',
  'used-elsewhere': 'You’ve already used this on another course.',
  'not-enough-time': 'There isn’t enough time left on your pass for the whole exam. Nothing was used.',
  'not-found': 'This course isn’t part of the free pass. Nothing was used.',
  'session-changed': 'You signed in on another tab.',
  'signed-out': 'You’ve been signed out.',
}
const RETRY = 'We couldn’t open it. Nothing was used.'

type Line = { text: string; action?: { label: string; href: string } }
/** The line after a refused open, with its one way on back to this page: sign in, or load it again. */
function lineFor(status: DiscoveryResult['status']): Line {
  const page = window.location.pathname
  const action = status === 'signed-out' ? { label: 'Sign in', href: `/login?next=${encodeURIComponent(page)}` }
    : status === 'session-changed' ? { label: 'Reload', href: page } : undefined
  return { text: REFUSAL[status] ?? RETRY, action }
}

/** `confirm`, when given, asks once before spending: a mis-tap on a list must never use the only one. */
export function OpenPreview({ continuityToken, command, label, quiet = false, confirm }: {
  continuityToken: string; command: OpenCommand; label: string; quiet?: boolean; confirm?: string
}): ReactElement {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Line | null>(null)
  // Another topic or exam in the same place starts clean: no message or open confirmation carries over.
  const commandKey = JSON.stringify(command)
  const [shownFor, setShownFor] = useState(commandKey)
  if (shownFor !== commandKey) { setShownFor(commandKey); setMessage(null); setConfirming(false) }

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
    setMessage(lineFor(result.status))
  }

  if (confirming) return <div className="grid gap-2 rounded-lg border border-student-border p-3" role="group"
    aria-label={label}>
    <p className="text-sm text-student-text-primary">{confirm}</p>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={() => { setConfirming(false); setMessage(null) }} disabled={busy}
        className={studentAction(btnGhost, 'bg-student-surface')}>Cancel</button>
      <button type="button" onClick={open} disabled={busy} className={studentAction(btnNavy, studentFocusDark)}>
        {busy ? 'Opening…' : 'Open it'}</button>
    </div>
    {message !== null && <MessageLine line={message} />}
  </div>
  return <div className="grid gap-2">
    <button type="button" onClick={confirm === undefined ? open : () => setConfirming(true)} disabled={busy} className={quiet
      ? studentAction(btnGhost, 'bg-student-surface', 'w-full justify-start text-left')
      : studentAction(btnNavy, studentFocusDark, 'w-full tablet:w-auto')}>
      {busy ? 'Opening…' : label}
    </button>
    {message !== null && <MessageLine line={message} />}
  </div>
}

function MessageLine({ line }: { line: Line }): ReactElement {
  return <p role="status" className="text-sm text-student-text-secondary">{line.text}
    {line.action ? <> <a href={line.action.href} className={studentAction(btnGhost, 'border-transparent px-2')}>
      {line.action.label}</a></> : null}</p>
}
