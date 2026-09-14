// app/reset-password/ResetPasswordForm.tsx — Password-only stage; the retained email/code accompany the single server request.
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AUTH_SUBMIT } from '@/components/chrome/FormField'
import { btnBase, btnSm, btnNavy, cx } from '@/components/chrome/ui'
import { PasswordField } from '@/components/auth/PasswordField'
import { Feedback } from '@/components/chrome/Feedback'
import type { AuthSubmitFailure } from '@/components/auth/useAuthSubmit'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { AUTH_API, PASSWORD_RESET_DESTINATION } from '@/lib/auth/constants'
import { resetSchema } from '@/lib/auth/schemas'

const formSchema = resetSchema.pick({ password: true }).extend({ confirmation: z.string() }).refine(value => value.password === value.confirmation,
  { message: 'Passwords must match.', path: ['confirmation'] })

/** A normal session grants no reset authority; the server requires the recovery code. */
export function ResetPasswordForm({ email, code, onFailure }: { email: string; code: string; onFailure: (failure: AuthSubmitFailure) => void }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema) })
  const { submit, pending, error } = useAuthSubmit()
  return <form method="post" noValidate className="space-y-4" onSubmit={handleSubmit(async values => {
    const { password } = values
    const result = await submit(AUTH_API.reset, { email, code, password }, onFailure)
    reset({ password: '', confirmation: '' })
    if (result) window.location.assign(PASSWORD_RESET_DESTINATION)
  })}>
    <PasswordField id="password" label="New password" autoComplete="new-password" {...register('password')} error={errors.password?.message} disabled={pending} />
    <PasswordField id="confirmation" label="Confirm password" autoComplete="new-password" {...register('confirmation')} error={errors.confirmation?.message} disabled={pending} />
    {error && <Feedback message={error} tone="error" />}
    <button disabled={pending} className={cx(btnBase, btnSm, btnNavy, AUTH_SUBMIT)}>{pending ? 'Resetting password…' : 'Reset password'}</button>
  </form>
}
