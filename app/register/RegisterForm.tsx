// app/register/RegisterForm.tsx — Registration and in-memory confirmation handoff.
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnNavy, cx } from '@/components/chrome/ui'
import { PasswordField } from '@/components/auth/PasswordField'
import { AuthNotice } from '@/components/auth/AuthNotice'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { ConfirmEmailForm } from '@/app/confirm-email/ConfirmEmailForm'
import { AUTH_API, AUTH_PATHS, EMAIL_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/auth/constants'
import { registerSchema } from '@/lib/auth/schemas'

const formSchema = registerSchema.extend({ confirmation: z.string() }).refine(value => value.password === value.confirmation,
  { message: 'Passwords must match.', path: ['confirmation'] })

/** Keep only email in memory after registration; clear password fields immediately. */
export function RegisterForm({ next }: { next: string }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema) })
  const { submit, pending, error } = useAuthSubmit()
  const [sentEmail, setSentEmail] = useState<string | null>(null)
  if (sentEmail !== null) return <div className="space-y-5">
    <AuthNotice message={'Check ' + sentEmail + ' for a confirmation code. If this address can receive confirmation, instructions will arrive shortly.'} />
    <ConfirmEmailForm email={sentEmail} next={next} />
  </div>
  return <form method="post" noValidate className="space-y-5" onSubmit={handleSubmit(async values => {
    const result = await submit(AUTH_API.register, { email: values.email, password: values.password })
    if (result) { reset(); setSentEmail(values.email) }
  })}>
    <FormField id="email" label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX_LENGTH} {...register('email')} error={errors.email?.message} disabled={pending} />
    <PasswordField id="password" label="Password" autoComplete="new-password" help={`Use at least ${PASSWORD_MIN_LENGTH} characters.`} {...register('password')} error={errors.password?.message} disabled={pending} />
    <PasswordField id="confirmation" label="Confirm password" autoComplete="new-password" {...register('confirmation')} error={errors.confirmation?.message} disabled={pending} />
    {error && <AuthNotice message={error} error />}
    <button disabled={pending} className={cx(btnBase, btnNavy, AUTH_SUBMIT)}>{pending ? 'Creating account…' : 'Create account'}</button>
    <div><Link href={AUTH_PATHS.login} className={AUTH_LINK}>Already have an account? Sign in</Link></div>
    <Link href={AUTH_PATHS.resend} className={AUTH_LINK}>Need another confirmation code?</Link>
  </form>
}
