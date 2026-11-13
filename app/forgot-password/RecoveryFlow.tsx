// app/forgot-password/RecoveryFlow.tsx — Email, server-verified code, password replacement, then its confirmation.
'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthSubmit, type AuthSubmitFailure } from '@/components/auth/useAuthSubmit'
import { FormField, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnGhost, btnSm, btnNavy, cx, focusRingNavy } from '@/components/chrome/ui'
import { recoveryVerificationSchema } from '@/lib/auth/schemas'
import { AuthShell } from '@/components/auth/AuthShell'
import { EmailForm } from '@/components/auth/EmailForm'
import { AuthFormLayout } from '@/components/auth/AuthFormLayout'
import { AUTH_API, OTP_MAX_LENGTH, PASSWORD_RESET_DESTINATION, RECOVERY_FAILURE, codeSentMessage } from '@/lib/auth/constants'
import { ResetPasswordForm } from '@/app/reset-password/ResetPasswordForm'

const TITLES = { request: 'Forgot password', code: 'Check your email', password: 'Change password', done: 'Password changed' } as const

/** Keep recovery inputs only in this mounted flow; never establish browser recovery authority. The flow confirms
 * the change itself ("Password changed", with Sign in), so no other screen carries a notice about it.
 */
export function RecoveryFlow() {
  const [email, setEmail] = useState<string | null>(null)
  const [verified, setVerified] = useState(false)
  const [changed, setChanged] = useState(false)
  const [notice, setNotice] = useState('')
  const content = useRef<HTMLDivElement>(null)
  const stage = changed ? 'done' : email === null ? 'request' : verified ? 'password' : 'code'
  // Each step starts on its first field; the confirmation starts on Sign in.
  useEffect(() => { content.current?.querySelector<HTMLElement>('input, a')?.focus() }, [stage])
  const startOver = () => { setEmail(null); setVerified(false); setNotice('') }
  const failed = (failure: AuthSubmitFailure) => {
    if (failure.code === RECOVERY_FAILURE.restart) {
      setEmail(null); setVerified(false); setNotice(failure.message)
    }
  }
  return <AuthShell title={TITLES[stage]}>
    <div ref={content}>
      {changed ? <Link href={PASSWORD_RESET_DESTINATION} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>Sign in</Link>
        : email === null ? <EmailForm recovery initialFeedback={notice ? { message: notice, tone: 'error' } : undefined} onRecoveryRequested={value => {
          setEmail(value); setNotice('')
        }} /> : !verified ? <RecoveryCodeForm email={email} onVerified={() => setVerified(true)} onStartOver={startOver} onFailure={failed} /> :
          <ResetPasswordForm email={email} onFailure={failed} onChanged={() => setChanged(true)} />}
    </div>
    <p className="sr-only" role="status" aria-live="polite">{changed ? `${TITLES.done}.` : ''}</p>
  </AuthShell>
}

function RecoveryCodeForm({ email, onVerified, onStartOver, onFailure }: {
  email: string; onVerified: () => void; onStartOver: () => void; onFailure: (failure: AuthSubmitFailure) => void
}) {
  const { register, handleSubmit, resetField, formState: { errors } } = useForm<{ code: string }>({
    resolver: zodResolver(recoveryVerificationSchema.pick({ code: true })), defaultValues: { code: '' },
  })
  const { submit, pending, error, clearError } = useAuthSubmit()
  const [resent, setResent] = useState(false)
  const verify = handleSubmit(async values => {
    const result = await submit(AUTH_API.verifyRecovery, { email, code: values.code }, onFailure)
    resetField('code')
    if (result?.verified === true) onVerified()
  })
  // Every attempt, valid or not, clears the last message.
  return <form method="post" noValidate onSubmit={event => { setResent(false); clearError(); return verify(event) }}>
    <AuthFormLayout
      fields={<>
        <p className="text-sm text-student-text-secondary">Enter the code you received at <span className="break-words font-medium">{email}</span>.</p>
    <FormField id="code" label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_MAX_LENGTH}
      {...register('code')} error={errors.code?.message} disabled={pending} />
      </>}
      feedback={{ message: error || (resent ? codeSentMessage(email) : ''), tone: error ? 'error' : 'info' }}
      primaryAction={<button disabled={pending} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>{pending ? 'Checking…' : 'Continue'}</button>}
      secondaryActions={<>
        <button type="button" disabled={pending} className={cx(btnBase, btnSm, btnGhost, focusRingNavy,
          'max-w-full !whitespace-normal text-center disabled:pointer-events-none disabled:opacity-60')} onClick={async () => {
      setResent(false); resetField('code')
      if (await submit(AUTH_API.forgot, { email })) setResent(true)
    }}>Didn't receive it? Resend code</button>
    <button type="button" disabled={pending} className={cx(btnBase, btnSm, btnGhost, focusRingNavy,
      'disabled:pointer-events-none disabled:opacity-60')} onClick={async () => {
      setResent(false)
      if (await submit(AUTH_API.cancelRecovery, { email })) { resetField('code'); onStartOver() }
    }}>Change email</button>
      </>}
    />
  </form>
}
