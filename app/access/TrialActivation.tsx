'use client'
// app/access/TrialActivation.tsx — Starting the Discovery Pass: one tap to ask, one to confirm. Nothing is asked for: no
// phone number and no code. The server verifies the session and the database decides everything else.
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Feedback } from '@/components/chrome/Feedback'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { postEntitlementCommand } from '@/lib/entitlements/client'
import { describeResult } from './trial-flow'
import type { FlowMessage } from './trial-flow'
import type { ReactElement, ReactNode } from 'react'

type Step = 'ask' | 'confirm' | 'closed'

// Whether the pass is still on offer on this page. A refusal withdraws it at once, so nothing on the page keeps
// describing or advertising a pass this account cannot start; the next render no longer offers it at all.
const PassOffer = createContext<{ withdrawn: boolean; withdraw(): void } | null>(null)

/** The part of the page that may mention the offer. */
export function PassOfferScope({ children }: { children: ReactNode }): ReactElement {
  const [withdrawn, setWithdrawn] = useState(false)
  return <PassOffer.Provider value={{ withdrawn, withdraw: () => setWithdrawn(true) }}>{children}</PassOffer.Provider>
}

/** Offer text: shown until a refusal withdraws the offer. */
export function WhileOffered({ children }: { children: ReactNode }): ReactNode {
  return useContext(PassOffer)?.withdrawn ? null : children
}

export function TrialActivation({ continuityToken, passHours }: {
  continuityToken: string
  passHours: number
}): ReactElement {
  const router = useRouter()
  const token = useRef(continuityToken).current
  const [step, setStep] = useState<Step>('ask')
  const [message, setMessage] = useState<FlowMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const notNow = useRef<HTMLButtonElement>(null)
  const start = useRef<HTMLButtonElement>(null)
  const asked = useRef(false)
  const offer = useContext(PassOffer)

  // Focus follows the step, so a keyboard or screen-reader user lands on the safe choice and returns where they were.
  useEffect(() => {
    if (step === 'confirm') notNow.current?.focus()
    else if (step === 'ask' && asked.current) start.current?.focus()
  }, [step])

  async function activate(): Promise<void> {
    setBusy(true)
    setMessage(null)
    const result = await postEntitlementCommand({ action: 'activate-discovery-pass' }, token)
    setBusy(false)
    const { message: next, next: after } = describeResult(result)
    setMessage(next)
    if (after === 'close') { setStep('closed'); offer?.withdraw() }
    if (after === 'refresh') router.refresh()
  }

  if (step === 'closed') return <div>{message && <Feedback tone={message.tone} message={message.text} />}</div>
  if (step === 'confirm') return <div className="grid gap-3 rounded-lg border border-student-border p-3" role="group"
    aria-labelledby="pass-confirm-question">
    <p id="pass-confirm-question" className="text-sm text-student-text-primary">
      Start your {passHours}-hour Discovery Pass now? It can be used only once.
    </p>
    <div className="grid grid-cols-2 gap-2 tablet:flex">
      <button ref={notNow} type="button" onClick={() => { setMessage(null); setStep('ask') }} disabled={busy}
        className={studentAction(btnGhost, 'bg-student-surface')}>Not now</button>
      <button type="button" onClick={() => void activate()} disabled={busy} aria-busy={busy}
        className={studentAction(btnNavy, studentFocusDark)}>{busy ? 'Starting…' : 'Start now'}</button>
    </div>
    {message && <Feedback tone={message.tone} message={message.text} />}
  </div>
  return <div>
    <button ref={start} type="button" onClick={() => { asked.current = true; setStep('confirm') }}
      className={studentAction(btnNavy, studentFocusDark)}>Start my Discovery Pass</button>
  </div>
}
