'use client'
// app/access/TrialActivation.tsx — The one tap that starts the Discovery Pass. Nothing is asked for: no phone number
// and no code. The server verifies the session and the database decides everything else.
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Feedback } from '@/components/chrome/Feedback'
import { btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { postEntitlementCommand } from '@/lib/entitlements/client'
import { describeResult } from './trial-flow'
import type { FlowMessage } from './trial-flow'
import type { ReactElement } from 'react'

export function TrialActivation({ continuityToken, passHours }: {
  continuityToken: string
  passHours: number
}): ReactElement {
  const router = useRouter()
  const token = useRef(continuityToken).current
  const [message, setMessage] = useState<FlowMessage | null>(null)
  const [busy, setBusy] = useState(false)

  async function activate(): Promise<void> {
    setBusy(true)
    const result = await postEntitlementCommand({ action: 'activate-discovery-pass' }, token)
    setBusy(false)
    const { message: next, next: step } = describeResult(result)
    setMessage(next)
    if (step === 'refresh') router.refresh()
  }

  return <div className="grid gap-3">
    <p className="text-sm text-student-text-secondary">
      Your {passHours} hours start the moment you tap. One pass per account; it can’t be paused or restarted.
    </p>
    <div>
      <button type="button" onClick={() => void activate()} disabled={busy} aria-busy={busy}
        className={studentAction(btnNavy, studentFocusDark)}>{busy ? 'Starting…' : 'Start my Discovery Pass'}</button>
    </div>
    {message && <Feedback tone={message.tone} message={message.text} />}
  </div>
}
