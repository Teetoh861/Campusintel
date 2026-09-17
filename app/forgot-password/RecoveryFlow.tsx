// app/forgot-password/RecoveryFlow.tsx — Email, server-verified recovery code, then password replacement.
'use client'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthSubmit, type AuthSubmitFailure } from '@/components/auth/useAuthSubmit'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnSm, btnNavy, cx } from '@/components/chrome/ui'
import { recoveryVerificationSchema } from '@/lib/auth/schemas'
import { AuthShell } from '@/components/auth/AuthShell'
import { EmailForm } from '@/components/auth/EmailForm'
import { AuthFormLayout } from '@/components/auth/AuthFormLayout'
import { AUTH_API, AUTH_MESSAGES, OTP_MAX_LENGTH, RECOVERY_FAILURE } from '@/lib/auth/constants'
import { ResetPasswordForm } from '@/app/reset-password/ResetPasswordForm'

/** Keep recovery inputs only in this mounted flow; never establish browser recovery authority. */
export function RecoveryFlow() {
  const [email, setEmail] = useState<string | null>(null)
  const [verified, setVerified] = useState(false)
  const [notice, setNotice] = useState('')
  const content = useRef<HTMLDivElement>(null)
  const stage = email === null ? 'request' : verified ? 'password' : 'code'
  useEffect(() => { content.current?.querySelector<HTMLInputElement>('input')?.focus() }, [stage])
  const startOver = () => { setEmail(null); setVerified(false); setNotice('') }
  const failed = (failure: AuthSubmitFailure) => {
    if (failure.code === RECOVERY_FAILURE.restart) {
      setEmail(null); setVerified(false); setNotice(failure.message)
    }
  }
  return <AuthShell title={stage === 'request' ? 'Forgot password' : stage === 'code' ? 'Check your email' : 'Change password'}>
    <div ref={content}>
      {email === null ? <EmailForm recovery initialFeedback={notice ? { message: notice, tone: 'error' } : undefined} onRecoveryRequested={value => {
        setEmail(value); setNotice('')
      }} /> : !verified ? <RecoveryCodeForm email={email} onVerified={() => setVerified(true)} onStartOver={startOver} onFailure={failed} /> :
        <ResetPasswordForm email={email} onFailure={failed} />}
    </div>
  </AuthShell>
}

function RecoveryCodeForm({ email, onVerified, onStartOver, onFailure }: {
  email: string; onVerified: () => void; onStartOver: () => void; onFailure: (failure: AuthSubmitFailure) => void
}) {
  const { register, handleSubmit, resetField, formState: { errors } } = useForm<{ code: string }>({
    resolver: zodResolver(recoveryVerificationSchema.pick({ code: true })), defaultValues: { code: '' },
  })
  const { submit, pending, error } = useAuthSubmit()
  const [resent, setResent] = useState(false)
  return <form method="post" noValidate onSubmit={handleSubmit(async values => {
    setResent(false)
    const result = await submit(AUTH_API.verifyRecovery, { email, code: values.code }, onFailure)
    resetField('code')
    if (result?.verified === true) onVerified()
  })}>
    <AuthFormLayout
      fields={<>
        <p className="text-sm text-ci-gray-700">Enter the recovery code you received at <span className="break-words font-medium">{email}</span>.</p>
    <FormField id="code" label="Verification code" inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_MAX_LENGTH}
      {...register('code')} error={errors.code?.message} disabled={pending} />
      </>}
      feedback={{ message: error || (resent ? AUTH_MESSAGES.recovery : ''), tone: error ? 'error' : 'info' }}
      primaryAction={<button disabled={pending} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>{pending ? 'Checking…' : 'Continue'}</button>}
      secondaryActions={<>
        <button type="button" disabled={pending} className={AUTH_LINK + ' text-sm disabled:opacity-60'} onClick={async () => {
      setResent(false); resetField('code')
      if (await submit(AUTH_API.forgot, { email })) setResent(true)
    }}>Didn't receive it? Resend code</button>
    <button type="button" disabled={pending} className={AUTH_LINK + ' text-sm disabled:opacity-60'} onClick={async () => {
      setResent(false)
      if (await submit(AUTH_API.cancelRecovery, {})) { resetField('code'); onStartOver() }
    }}>Change email</button>
      </>}
    />
  </form>
}
