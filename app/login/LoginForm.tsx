// app/login/LoginForm.tsx — Password login UX; Supabase authentication remains on the server.
'use client'
import { useState } from 'react'
import { ConfirmEmailForm } from '@/app/confirm-email/ConfirmEmailForm'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnSm, btnNavy, cx } from '@/components/chrome/ui'
import { PasswordField } from '@/components/auth/PasswordField'
import { Feedback } from '@/components/chrome/Feedback'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { AUTH_API, AUTH_PATHS, EMAIL_CONFIRMATION_REQUIRED, EMAIL_MAX_LENGTH, type ConfirmationDelivery } from '@/lib/auth/constants'
import { loginSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'

/** Navigate only to the validated application destination after server login. */
export function LoginForm({ next }: { next: string }) {
  const { register, handleSubmit, resetField, reset, formState: { errors } } = useForm<{ email: string; password: string }>({ resolver: zodResolver(loginSchema) })
  const { submit, pending, error } = useAuthSubmit()
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null)
  const [delivery, setDelivery] = useState<ConfirmationDelivery>('failed')
  if (confirmationEmail !== null) return <ConfirmEmailForm delivery={delivery} email={confirmationEmail} next={next} onStartOver={() => { reset({ email: '', password: '' }); setConfirmationEmail(null) }} />
  return <form method="post" noValidate className="space-y-4" onSubmit={handleSubmit(async values => {
    const result = await submit(AUTH_API.login, { ...values, next })
    resetField('password')
    if (result?.code === EMAIL_CONFIRMATION_REQUIRED) { setDelivery(result.delivery ?? 'failed'); setConfirmationEmail(values.email); return }
    if (result) window.location.assign(getSafeReturnPath(result.next))
  })}>
    <FormField id="email" label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX_LENGTH} {...register('email')} error={errors.email?.message} disabled={pending} />
    <PasswordField id="password" label="Password" autoComplete="current-password" {...register('password')} error={errors.password?.message} disabled={pending} />
    {error && <Feedback message={error} tone="error" />}
    <button disabled={pending} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>{pending ? 'Signing in…' : 'Sign in'}</button>
    <div className="flex flex-col items-start">
      <Link href={AUTH_PATHS.forgot} className={AUTH_LINK}>Forgot password?</Link>
      <Link href={AUTH_PATHS.register + '?next=' + encodeURIComponent(next)} className={AUTH_LINK}>Create account</Link>
    </div>
  </form>
}
