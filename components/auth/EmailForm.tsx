// components/auth/EmailForm.tsx — Shared confirmation-resend and password-recovery email request.
'use client'
import { ConfirmEmailForm } from '@/app/confirm-email/ConfirmEmailForm'
import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnSm, btnNavy, cx } from '@/components/chrome/ui'
import { AUTH_API, AUTH_PATHS, AUTH_MESSAGES, EMAIL_MAX_LENGTH } from '@/lib/auth/constants'
import { emailRequestSchema } from '@/lib/auth/schemas'
import { Feedback } from '@/components/chrome/Feedback'
import { useAuthSubmit } from './useAuthSubmit'

/** Request email using the same enumeration-safe surface for either purpose. */
export function EmailForm({ recovery = false, onRecoveryRequested }: { recovery?: boolean; onRecoveryRequested?: (email: string) => void }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<{ email: string }>({ resolver: zodResolver(emailRequestSchema) })
  const { submit, pending, error } = useAuthSubmit()
  const [message, setMessage] = useState('')
  const [sentEmail, setSentEmail] = useState<string | null>(null)
  if (sentEmail !== null && !recovery) return <ConfirmEmailForm email={sentEmail} onStartOver={() => { reset({ email: '' }); setMessage(''); setSentEmail(null) }} />
  return <form method="post" onSubmit={handleSubmit(async values => {
    const result = await submit(recovery ? AUTH_API.forgot : AUTH_API.resend, values)
    if (result && recovery && onRecoveryRequested) { onRecoveryRequested(values.email); return }
    if (result) { setMessage(recovery ? AUTH_MESSAGES.recovery : AUTH_MESSAGES.email); setSentEmail(values.email) }
  })} className="space-y-4" noValidate>
    <FormField id="email" label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX_LENGTH}
      {...register('email')} error={errors.email?.message} disabled={pending} />
    {error && <Feedback message={error} tone="error" />}
    {message && <Feedback message={message} />}
    <button disabled={pending} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>{pending ? 'Sending…' : 'Send verification code'}</button>
    {recovery && !onRecoveryRequested && <Link href={AUTH_PATHS.reset} className={AUTH_LINK}>I have a recovery code</Link>}
  </form>
}
