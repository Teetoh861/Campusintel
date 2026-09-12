// app/login/LoginForm.tsx — Password login UX; Supabase authentication remains on the server.
'use client'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnNavy, cx } from '@/components/chrome/ui'
import { PasswordField } from '@/components/auth/PasswordField'
import { AuthNotice } from '@/components/auth/AuthNotice'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { AUTH_API, AUTH_PATHS, EMAIL_MAX_LENGTH } from '@/lib/auth/constants'
import { loginSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'

/** Navigate only to the validated application destination after server login. */
export function LoginForm({ next }: { next: string }) {
  const { register, handleSubmit, resetField, formState: { errors } } = useForm<{ email: string; password: string }>({ resolver: zodResolver(loginSchema) })
  const { submit, pending, error } = useAuthSubmit()
  return <form method="post" noValidate className="space-y-5" onSubmit={handleSubmit(async values => {
    const result = await submit(AUTH_API.login, { ...values, next })
    resetField('password')
    if (result) window.location.assign(getSafeReturnPath(result.next))
  })}>
    <FormField id="email" label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX_LENGTH} {...register('email')} error={errors.email?.message} disabled={pending} />
    <PasswordField id="password" label="Password" autoComplete="current-password" {...register('password')} error={errors.password?.message} disabled={pending} />
    {error && <AuthNotice message={error} error />}
    <button disabled={pending} className={cx(btnBase, btnNavy, AUTH_SUBMIT)}>{pending ? 'Signing in…' : 'Sign in'}</button>
    <div className="flex flex-col items-start">
      <Link href={AUTH_PATHS.forgot} className={AUTH_LINK}>Forgot password?</Link>
      <Link href={AUTH_PATHS.register + '?next=' + encodeURIComponent(next)} className={AUTH_LINK}>Create an account</Link>
      <Link href={AUTH_PATHS.confirm} className={AUTH_LINK}>Confirm your email</Link>
    </div>
  </form>
}
