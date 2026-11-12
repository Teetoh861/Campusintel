// app/login/LoginForm.tsx — Password login UX; Supabase authentication remains on the server.
'use client'
import { useEffect, useState } from 'react'
import { ConfirmEmailForm } from '@/app/confirm-email/ConfirmEmailForm'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnSm, btnNavy, cx } from '@/components/chrome/ui'
import { PasswordField } from '@/components/auth/PasswordField'
import { AuthFormLayout, authSecondaryNav, type AuthFormFeedback } from '@/components/auth/AuthFormLayout'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { AUTH_API, AUTH_PATHS, EMAIL_CONFIRMATION_REQUIRED, EMAIL_MAX_LENGTH } from '@/lib/auth/constants'
import { loginSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'

// The address parameter a notice from another screen arrives in (an account scheduled for deletion).
const NOTICE_PARAM = 'state'

/** Navigate only to the validated application destination after server login. A notice the page was opened with
 * shows once: it leaves the address as the page loads, and it goes on the first submit attempt, valid or not.
 */
export function LoginForm({ next, initialFeedback }: { next: string; initialFeedback?: AuthFormFeedback }) {
  const { register, handleSubmit, resetField, reset, formState: { errors } } = useForm<{ email: string; password: string }>({ resolver: zodResolver(loginSchema) })
  const { submit, pending, error, clearError } = useAuthSubmit()
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null)
  const [notice, setNotice] = useState(initialFeedback)
  const [navigating, setNavigating] = useState(false)
  const busy = pending || navigating
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(NOTICE_PARAM)) return
    url.searchParams.delete(NOTICE_PARAM)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])
  const startOver = () => { reset({ email: '', password: '' }); setConfirmationEmail(null) }
  if (confirmationEmail !== null) return <ConfirmEmailForm email={confirmationEmail} next={next} onStartOver={startOver} />
  const signIn = handleSubmit(async values => {
    const result = await submit(AUTH_API.login, { ...values, next })
    if (result?.code === EMAIL_CONFIRMATION_REQUIRED) { resetField('password'); setConfirmationEmail(values.email); return }
    if (result) { setNavigating(true); window.location.assign(getSafeReturnPath(result.next)) }
  })
  return <form method="post" noValidate onSubmit={event => { setNotice(undefined); clearError(); return signIn(event) }}>
    <AuthFormLayout
      fields={<>
        <FormField id="email" label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX_LENGTH} {...register('email')} error={errors.email?.message} disabled={busy} />
    <PasswordField id="password" label="Password" autoComplete="current-password" {...register('password')} error={errors.password?.message} disabled={busy} />
      </>}
      feedback={error ? { message: error, tone: 'error' } : (notice ?? { message: '' })}
      primaryAction={<button disabled={busy} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>{busy ? 'Signing in…' : 'Sign in'}</button>}
      secondaryActions={<>
        <Link href={AUTH_PATHS.forgot} className={authSecondaryNav}>Forgot password?</Link>
      <Link href={AUTH_PATHS.register + '?next=' + encodeURIComponent(next)} className={authSecondaryNav}>Create account</Link>
      </>}
    />
  </form>
}
