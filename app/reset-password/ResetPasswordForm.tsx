// app/reset-password/ResetPasswordForm.tsx — Password-only form, authorized by the server-controlled recovery grant.
'use client'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnSm, btnNavy, cx } from '@/components/chrome/ui'
import { PasswordField } from '@/components/auth/PasswordField'
import { AuthFormLayout } from '@/components/auth/AuthFormLayout'
import type { AuthSubmitFailure } from '@/components/auth/useAuthSubmit'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { AUTH_API, RECOVERY_FAILURE } from '@/lib/auth/constants'
import { resetSchema } from '@/lib/auth/schemas'

const formSchema = resetSchema.pick({ password: true }).extend({ confirmation: z.string() }).refine(value => value.password === value.confirmation,
  { message: 'Passwords must match.', path: ['confirmation'] })

/** A normal session grants no reset authority; the server uses the verified recovery grant. A new password the
 * provider refuses (weak or reused) keeps the student here, with the reason under the field; the grant is still
 * theirs, so the next password can be tried straight away.
 */
export function ResetPasswordForm({ email, onFailure, onChanged }: {
  email: string; onFailure: (failure: AuthSubmitFailure) => void; onChanged: () => void
}) {
  const { register, handleSubmit, reset, setFocus, formState: { errors } } = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema), defaultValues: { password: '', confirmation: '' } })
  const { submit, pending, error, clearError } = useAuthSubmit()
  // Why the provider refused the last password. It belongs under the field, not in the form's message.
  const [rejected, setRejected] = useState('')
  const forget = () => { setRejected(''); clearError() }
  // The reason is the field's description (FormField ties it with aria-describedby), so once the field is enabled
  // again, focus goes back to it: a screen reader then announces New password, invalid, and why.
  useEffect(() => { if (rejected && !pending) setFocus('password') }, [rejected, pending, setFocus])
  const change = handleSubmit(async values => {
    const { password } = values
    const result = await submit(AUTH_API.reset, { email, password }, failure => {
      if (failure.code === RECOVERY_FAILURE.password) setRejected(failure.message)
      onFailure(failure)
    })
    reset({ password: '', confirmation: '' })
    if (result) onChanged()
  })
  // Every attempt, valid or not, clears the last message; so does typing another password after a refusal.
  return <form method="post" noValidate onSubmit={event => { forget(); return change(event) }}>
    <AuthFormLayout
      fields={<>
        <PasswordField id="password" label="New password" autoComplete="new-password"
          {...register('password', { onChange: () => { if (rejected) forget() } })}
          error={errors.password?.message ?? (rejected || undefined)} disabled={pending} />
    <PasswordField id="confirmation" label="Confirm password" autoComplete="new-password" {...register('confirmation')} error={errors.confirmation?.message} disabled={pending} />
      </>}
      feedback={{ message: rejected ? '' : error, tone: 'error' }}
      primaryAction={<button disabled={pending} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>{pending ? 'Changing password…' : 'Change password'}</button>}
    />
  </form>
}
