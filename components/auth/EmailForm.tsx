// components/auth/EmailForm.tsx — Shared confirmation-resend and password-recovery email request.
'use client'
import { ConfirmEmailForm } from '@/app/confirm-email/ConfirmEmailForm'
import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnSm, btnNavy, cx } from '@/components/chrome/ui'
import { AUTH_API, AUTH_PATHS, EMAIL_MAX_LENGTH } from '@/lib/auth/constants'
import { emailRequestSchema } from '@/lib/auth/schemas'
import { AuthFormLayout, type AuthFormFeedback } from '@/components/auth/AuthFormLayout'
import { useAuthSubmit } from './useAuthSubmit'

/** Request email using the same enumeration-safe surface for either purpose. */
export function EmailForm({ recovery = false, onRecoveryRequested, initialFeedback }: {
  recovery?: boolean; onRecoveryRequested?: (email: string) => void; initialFeedback?: AuthFormFeedback
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<{ email: string }>({ resolver: zodResolver(emailRequestSchema) })
  const { submit, pending, error } = useAuthSubmit()
  const [requestedEmail, setRequestedEmail] = useState<string | null>(null)
  const [notice, setNotice] = useState(initialFeedback)
  const startOver = () => { reset({ email: '' }); setRequestedEmail(null) }
  if (requestedEmail !== null) return <ConfirmEmailForm email={requestedEmail} onStartOver={startOver} />
  return <form method="post" onSubmit={handleSubmit(async values => {
    setNotice(undefined)
    const result = await submit(recovery ? AUTH_API.forgot : AUTH_API.resend, values)
    if (!result) return
    // The owning flow continues recovery; confirmation continues here with the same neutral response.
    if (recovery) onRecoveryRequested?.(values.email)
    else setRequestedEmail(values.email)
  })} noValidate>
    <AuthFormLayout
      fields={<>
        <FormField id="email" label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX_LENGTH}
      {...register('email')} error={errors.email?.message} disabled={pending} />
      </>}
      feedback={error ? { message: error, tone: 'error' } : (notice ?? { message: '' })}
      primaryAction={<button disabled={pending} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>{pending ? 'Sending…' : recovery ? 'Send recovery code' : 'Send verification code'}</button>}
      secondaryActions={recovery && !onRecoveryRequested && <Link href={AUTH_PATHS.reset} className={AUTH_LINK}>I have a recovery code</Link>}
    />
  </form>
}
