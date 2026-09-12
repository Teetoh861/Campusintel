// app/confirm-email/ConfirmEmailForm.tsx — Confirmation code submission with optional in-memory email prefill.
'use client'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnNavy, cx } from '@/components/chrome/ui'
import { AuthNotice } from '@/components/auth/AuthNotice'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { AUTH_API, AUTH_PATHS, EMAIL_MAX_LENGTH, OTP_MAX_LENGTH } from '@/lib/auth/constants'
import { confirmSchema } from '@/lib/auth/schemas'
import { getSafeReturnPath } from '@/lib/auth/redirect'

/** Submit the code only in a POST body; a page visit never verifies an account. */
export function ConfirmEmailForm({ email = '', next }: { email?: string; next?: string }) {
  const { register, handleSubmit, resetField, formState: { errors } } = useForm<{ email: string; code: string }>({
    resolver: zodResolver(confirmSchema), defaultValues: { email, code: '' },
  })
  const { submit, pending, error } = useAuthSubmit()
  return <form method="post" noValidate className="space-y-5" onSubmit={handleSubmit(async values => {
    const result = await submit(AUTH_API.confirm, { ...values, next: getSafeReturnPath(next) })
    resetField('code')
    if (result) window.location.assign(getSafeReturnPath(result.next))
  })}>
    <FormField id="email" label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX_LENGTH}
      {...register('email')} error={errors.email?.message} disabled={pending} />
    <FormField id="code" label="Verification code" inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_MAX_LENGTH}
      {...register('code')} error={errors.code?.message} disabled={pending} help="Enter the code from your confirmation email." />
    {error && <AuthNotice message={error} error />}
    <button disabled={pending} className={cx(btnBase, btnNavy, AUTH_SUBMIT)}>{pending ? 'Confirming…' : 'Confirm email'}</button>
    <Link href={AUTH_PATHS.resend} className={AUTH_LINK}>Send another confirmation code</Link>
  </form>
}
