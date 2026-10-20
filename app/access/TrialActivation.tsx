'use client'
// app/access/TrialActivation.tsx — One-time phone check that starts the Discovery Pass. Login never asks for it.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Feedback } from '@/components/chrome/Feedback'
import { FormField } from '@/components/chrome/FormField'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { postEntitlementCommand } from '@/lib/entitlements/client'
import { OTP_CODE_LENGTH } from '@/lib/entitlements/contract'
import { describeResult } from './trial-flow'
import type { FlowMessage } from './trial-flow'
import type { FormEvent, ReactElement } from 'react'

type Challenge = { challengeId: string; phoneHint: string; resendAt: string }

/** Seconds until a new code may be requested; 0 when it may be requested now. */
function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000))
}

export function TrialActivation({ continuityToken, passHours, initialChallenge }: {
  continuityToken: string
  passHours: number
  /** A code sent earlier in this session, so a reload resumes at the code step. */
  initialChallenge: Challenge | null
}): ReactElement {
  const router = useRouter()
  const token = useRef(continuityToken).current
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<Challenge | null>(initialChallenge)
  const [message, setMessage] = useState<FlowMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)

  // A once-a-second countdown for the resend button; it reads the clock only after hydration.
  useEffect(() => {
    if (challenge === null) return
    const resendAt = challenge.resendAt
    const tick = () => setWait(secondsUntil(resendAt, Date.now()))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [challenge])

  async function sendCode(): Promise<void> {
    setBusy(true)
    const result = await postEntitlementCommand({ action: 'send-trial-code', phone }, token)
    setBusy(false)
    const { message: next, next: step } = describeResult(result)
    setMessage(next)
    if (result.status === 'code-sent' || result.status === 'delivery-failed') {
      setCode('')
      setChallenge({ challengeId: result.challengeId, phoneHint: result.phoneHint, resendAt: result.resendAt })
    }
    if (step === 'refresh') router.refresh()
  }

  async function submitPhone(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await sendCode()
  }

  async function submitCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (challenge === null) return
    setBusy(true)
    const result = await postEntitlementCommand({ action: 'verify-trial-code', challengeId: challenge.challengeId, code }, token)
    setBusy(false)
    const { message: next, next: step } = describeResult(result)
    setMessage(next)
    if (step === 'restart') { setChallenge(null); setCode('') }
    if (step === 'refresh') router.refresh()
  }

  function changeNumber(): void {
    setChallenge(null)
    setCode('')
    setMessage(null)
  }

  return <div className="grid gap-4">
    {challenge === null
      ? <form onSubmit={submitPhone} className="grid gap-3" noValidate>
        <p className="text-sm text-student-text-secondary">
          We’ll text a one-time code to confirm your number. Each phone number can start one pass, and its {passHours} hours begin as soon as you confirm.
          You’ll keep signing in with your email and password.
        </p>
        <FormField id="trial-phone" name="phone" label="Nigerian mobile number" type="tel" inputMode="tel"
          autoComplete="tel" required maxLength={24} value={phone} disabled={busy}
          onChange={event => setPhone(event.target.value)} help="For example 0803 123 4567" />
        <div><button type="submit" disabled={busy || phone.trim() === ''} aria-busy={busy}
          className={studentAction(btnNavy, studentFocusDark)}>{busy ? 'Sending…' : 'Send code'}</button></div>
      </form>
      : <form onSubmit={submitCode} className="grid gap-3" noValidate>
        <p className="text-sm text-student-text-secondary">Enter the code sent to the number ending {challenge.phoneHint}.</p>
        <FormField id="trial-code" name="code" label="6-digit code" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]*" required maxLength={OTP_CODE_LENGTH} value={code} disabled={busy}
          onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH))} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || code.length !== OTP_CODE_LENGTH} aria-busy={busy}
            className={studentAction(btnNavy, studentFocusDark)}>{busy ? 'Checking…' : 'Start my Discovery Pass'}</button>
          {phone.trim() !== '' && <button type="button" onClick={() => void sendCode()} disabled={busy || wait > 0}
            className={studentAction(btnGhost)}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>}
          <button type="button" onClick={changeNumber} disabled={busy} className={studentAction(btnGhost)}>
            {phone.trim() === '' ? 'Send a new code' : 'Change number'}
          </button>
        </div>
      </form>}
    {message && <Feedback tone={message.tone} message={message.text} />}
  </div>
}
