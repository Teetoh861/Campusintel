// app/reset-password/ResetPasswordForm.tsx — Recovery code and new password in a single POST.
'use client'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnNavy, cx } from '@/components/chrome/ui'
import { PasswordField } from '@/components/auth/PasswordField'
import { AuthNotice } from '@/components/auth/AuthNotice'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { AUTH_API, AUTH_PATHS, PASSWORD_RESET_DESTINATION, EMAIL_MAX_LENGTH, OTP_MAX_LENGTH } from '@/lib/auth/constants'
import { resetSchema } from '@/lib/auth/schemas'

const formSchema = resetSchema.extend({ confirmation: z.string() }).refine(value => value.password === value.confirmation,
  { message: 'Passwords must match.', path: ['confirmation'] })

/** A normal session grants no reset authority; the server requires the recovery code. */
export function ResetPasswordForm() {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema) })
  const { submit, pending, error } = useAuthSubmit()
  return <form method="post" noValidate className="space-y-5" onSubmit={handleSubmit(async values => {
    const { email, code, password } = values
    const result = await submit(AUTH_API.reset, { email, code, password })
    reset({ email, code: '', password: '', confirmation: '' })
    if (result) window.location.assign(PASSWORD_RESET_DESTINATION)
  })}>
    <FormField id="email" label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX_LENGTH} {...register('email')} error={errors.email?.message} disabled={pending} />
    <FormField id="code" label="Recovery code" inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_MAX_LENGTH}
      {...register('code')} error={errors.code?.message} disabled={pending} help="Use the code from your password reset email." />
    <PasswordField id="password" label="New password" autoComplete="new-password" {...register('password')} error={errors.password?.message} disabled={pending} />
    <PasswordField id="confirmation" label="Confirm password" autoComplete="new-password" {...register('confirmation')} error={errors.confirmation?.message} disabled={pending} />
    {error && <AuthNotice message={error} error />}
    <button disabled={pending} className={cx(btnBase, btnNavy, AUTH_SUBMIT)}>{pending ? 'Resetting password…' : 'Reset password'}</button>
    <Link href={AUTH_PATHS.forgot} className={AUTH_LINK}>Request a new recovery code</Link>
  </form>
}
