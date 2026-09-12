// components/auth/EmailForm.tsx — Shared confirmation-resend and password-recovery email request.
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, AUTH_LINK, AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnNavy, cx } from '@/components/chrome/ui'
import { AUTH_API, AUTH_PATHS, EMAIL_MAX_LENGTH } from '@/lib/auth/constants'
import { emailRequestSchema } from '@/lib/auth/schemas'
import { AuthNotice } from './AuthNotice'
import { useAuthSubmit } from './useAuthSubmit'

/** Request email using the same enumeration-safe surface for either purpose. */
export function EmailForm({ recovery = false }: { recovery?: boolean }) {
  const { register, handleSubmit, formState: { errors } } = useForm<{ email: string }>({ resolver: zodResolver(emailRequestSchema) })
  const { submit, pending, error } = useAuthSubmit()
  const [message, setMessage] = useState('')
  return <form method="post" onSubmit={handleSubmit(async values => {
    const result = await submit(recovery ? AUTH_API.forgot : AUTH_API.resend, values)
    if (result) setMessage(result.message || 'Check your email for instructions.')
  })} className="space-y-5" noValidate>
    <FormField id="email" label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX_LENGTH}
      {...register('email')} error={errors.email?.message} disabled={pending} />
    {error && <AuthNotice message={error} error />}
    {message && <AuthNotice message={message} />}
    <button disabled={pending} className={cx(btnBase, btnNavy, AUTH_SUBMIT)}>{pending ? 'Sending…' : 'Send verification code'}</button>
    <Link href={recovery ? AUTH_PATHS.reset : AUTH_PATHS.confirm} className={AUTH_LINK}>I have a verification code</Link>
  </form>
}
