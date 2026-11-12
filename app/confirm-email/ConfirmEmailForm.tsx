// app/confirm-email/ConfirmEmailForm.tsx — Confirmation code submission with a bound in-memory email.
'use client'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnGhost, btnSm, btnNavy, cx, focusRingNavy } from '@/components/chrome/ui'
import { AuthFormLayout } from '@/components/auth/AuthFormLayout'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { AUTH_API, OTP_MAX_LENGTH, codeSentMessage } from '@/lib/auth/constants'
import { confirmSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'

/** Submit the code only in a POST body; a page visit never verifies an account. Every attempt, valid or not,
 * clears the last message, and the form stays busy from a confirmed code until the next page has loaded.
 */
export function ConfirmEmailForm({ email, next, onStartOver }: { email: string; next?: string; onStartOver: () => void }) {
  const { register, handleSubmit, resetField, formState: { errors } } = useForm<{ code: string }>({
    resolver: zodResolver(confirmSchema.pick({ code: true })), defaultValues: { code: '' },
  })
  const { submit, pending, error, clearError } = useAuthSubmit()
  const [message, setMessage] = useState('')
  const [navigating, setNavigating] = useState(false)
  const busy = pending || navigating
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const confirm = handleSubmit(async values => {
    const result = await submit(AUTH_API.confirm, { email, code: values.code, next: getSafeReturnPath(next) })
    if (result) { setNavigating(true); window.location.assign(getSafeReturnPath(result.next)); return }
    resetField('code')
  })
  return <form method="post" noValidate onSubmit={event => { setMessage(''); clearError(); return confirm(event) }}>
    <AuthFormLayout
      fields={<>
        <div><h2 tabIndex={-1} ref={heading} className="text-lg font-semibold text-student-primary">Confirm email</h2><p className="mt-1 text-sm text-student-text-secondary">Enter the code you received at <span className="break-words font-medium">{email}</span>.</p></div>
    <FormField id="code" label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_MAX_LENGTH}
      {...register('code')} error={errors.code?.message} disabled={busy} />
      </>}
      feedback={{ message: error || message, tone: error ? 'error' : 'success' }}
      primaryAction={<button disabled={busy} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>{busy ? 'Confirming…' : 'Confirm email'}</button>}
      secondaryActions={<>
        <button type="button" disabled={busy} className={cx(btnBase, btnSm, btnGhost, focusRingNavy, 'disabled:pointer-events-none disabled:opacity-60')} onClick={async () => {
      setMessage('')
      resetField('code')
      const result = await submit(AUTH_API.resend, { email })
      if (result) setMessage(codeSentMessage(email))
    }}>Resend code</button>
    <button type="button" disabled={busy} onClick={onStartOver} className={cx(btnBase, btnSm, btnGhost, focusRingNavy, 'disabled:pointer-events-none disabled:opacity-60')}>Change email</button>
      </>}
    />
  </form>
}
