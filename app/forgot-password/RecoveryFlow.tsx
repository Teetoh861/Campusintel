// app/forgot-password/RecoveryFlow.tsx — Two visual stages; recovery is verified only on final submission.
'use client'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AuthShell } from '@/components/auth/AuthShell'
import { EmailForm } from '@/components/auth/EmailForm'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { Feedback } from '@/components/chrome/Feedback'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnSm, btnNavy, cx } from '@/components/chrome/ui'
import { AUTH_API, AUTH_MESSAGES, OTP_MAX_LENGTH, RECOVERY_FAILURE } from '@/lib/auth/constants'
import { resetSchema } from '@/lib/auth/schemas'
import { ResetPasswordForm } from '@/app/reset-password/ResetPasswordForm'

/** Keep recovery inputs only in this mounted flow; never establish browser recovery authority. */
export function RecoveryFlow() {
  const [email, setEmail] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const stage = email === null ? 'request' : code === null ? 'code' : 'password'
  useEffect(() => { content.current?.querySelector<HTMLInputElement>('input')?.focus() }, [stage])
  const startOver = () => { setEmail(null); setCode(null); setNotice(''); setRestartRequired(false) }
  return <AuthShell title={stage === 'request' ? 'Forgot password' : stage === 'code' ? 'Check your email' : 'Choose a new password'}>
    <div ref={content} className="space-y-4">
      {notice && <Feedback message={notice} tone="error" />}
      {restartRequired && <p className="text-sm text-ci-gray-700">{AUTH_MESSAGES.recoveryRestart}</p>}
      {email === null ? <EmailForm recovery onRecoveryRequested={value => {
        setEmail(value); setNotice(''); setRestartRequired(false)
      }} /> : code === null ? <RecoveryCodeForm email={email} onContinue={value => {
        setCode(value); setNotice('')
      }} onStartOver={startOver} /> : <ResetPasswordForm email={email} code={code} onFailure={failure => {
        if (failure.code === RECOVERY_FAILURE.invalidCode) {
          setCode(null); setNotice(failure.message)
        } else if (failure.code === RECOVERY_FAILURE.restart) {
          setCode(null); setEmail(null); setNotice(failure.message); setRestartRequired(true)
        }
      }} />}
    </div>
  </AuthShell>
}

function RecoveryCodeForm({ email, onContinue, onStartOver }: {
  email: string; onContinue: (code: string) => void; onStartOver: () => void
}) {
  const { register, handleSubmit, resetField, formState: { errors } } = useForm<{ code: string }>({
    resolver: zodResolver(resetSchema.pick({ code: true })), defaultValues: { code: '' },
  })
  const { submit, pending, error } = useAuthSubmit()
  const [resent, setResent] = useState(false)
  return <form method="post" noValidate className="space-y-4" onSubmit={handleSubmit(values => {
    if (!pending) onContinue(values.code)
  })}>
    <p className="text-sm text-ci-gray-700">We sent a recovery code to <span className="break-words font-medium">{email}</span>.</p>
    <FormField id="code" label="Recovery code" inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_MAX_LENGTH}
      {...register('code')} error={errors.code?.message} disabled={pending} />
    {error && <Feedback message={error} tone="error" />}
    <button disabled={pending} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>Continue</button>
    {resent && <Feedback message={AUTH_MESSAGES.codeResent} tone="success" />}
    <button type="button" disabled={pending} className={AUTH_LINK + ' text-sm disabled:opacity-60'} onClick={async () => {
      setResent(false); resetField('code')
      if (await submit(AUTH_API.forgot, { email })) setResent(true)
    }}>Didn't receive it? Resend code</button>
    <button type="button" disabled={pending} onClick={onStartOver} className={AUTH_LINK + ' text-sm disabled:opacity-60'}>Wrong email? Start over</button>
  </form>
}
