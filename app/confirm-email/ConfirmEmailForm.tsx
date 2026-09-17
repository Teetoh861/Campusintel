// app/confirm-email/ConfirmEmailForm.tsx — Confirmation code submission with a bound in-memory email.
'use client'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnSm, btnNavy, cx } from '@/components/chrome/ui'
import { AuthFormLayout } from '@/components/auth/AuthFormLayout'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { AUTH_API, AUTH_MESSAGES, OTP_MAX_LENGTH } from '@/lib/auth/constants'
import { confirmSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'

/** Submit the code only in a POST body; a page visit never verifies an account. */
export function ConfirmEmailForm({ email, next, onStartOver }: { email: string; next?: string; onStartOver: () => void }) {
  const { register, handleSubmit, resetField, formState: { errors } } = useForm<{ code: string }>({
    resolver: zodResolver(confirmSchema.pick({ code: true })), defaultValues: { code: '' },
  })
  const { submit, pending, error } = useAuthSubmit()
  const [message, setMessage] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <form method="post" noValidate onSubmit={handleSubmit(async values => {
    setMessage('')
    const result = await submit(AUTH_API.confirm, { email, code: values.code, next: getSafeReturnPath(next) })
    resetField('code')
    if (result) window.location.assign(getSafeReturnPath(result.next))
  })}>
    <AuthFormLayout
      fields={<>
        <div><h2 tabIndex={-1} ref={heading} className="text-lg font-semibold text-ci-navy">Confirm email</h2><p className="mt-1 text-sm text-ci-gray-700">Enter the code you received at <span className="break-words font-medium">{email}</span>.</p></div>
    <FormField id="code" label="Verification code" inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_MAX_LENGTH}
      {...register('code')} error={errors.code?.message} disabled={pending} />
      </>}
      feedback={{ message: error || message, tone: error ? 'error' : 'success' }}
      primaryAction={<button disabled={pending} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>{pending ? 'Confirming…' : 'Confirm email'}</button>}
      secondaryActions={<>
        <button type="button" disabled={pending} className={AUTH_LINK + ' text-sm disabled:opacity-60'} onClick={async () => {
      setMessage('')
      resetField('code')
      const result = await submit(AUTH_API.resend, { email })
      if (result) setMessage(AUTH_MESSAGES.email)
    }}>Resend code</button>
    <button type="button" disabled={pending} onClick={onStartOver} className={AUTH_LINK + ' text-sm disabled:opacity-60'}>Change email</button>
      </>}
    />
  </form>
}
