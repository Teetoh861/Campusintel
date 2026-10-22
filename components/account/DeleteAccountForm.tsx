'use client'
import { useRef, useState } from 'react'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { FormField } from '@/components/chrome/FormField'
import { Feedback } from '@/components/chrome/Feedback'
import { btnNavy, btnGhost } from '@/components/chrome/ui'
import { studentAction } from '@/components/student/ui'
import { AUTH_API, PASSWORD_MAX_LENGTH } from '@/lib/auth/constants'
import { ACCOUNT_DELETION_GRACE_DAYS } from '@/lib/account/constants'
import type { FormEvent } from 'react'
import { DISCOVERY_CLAIM_RETENTION_MONTHS } from '@/lib/entitlements/contract'

/** Require an explicit, accessible confirmation and keep the password in the form only. */
export function DeleteAccountForm({ continuityToken }: { continuityToken: string }) {
  const token = useRef(continuityToken).current
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const { submit, pending, error } = useAuthSubmit()
  function close() {
    setOpen(false)
    trigger.current?.focus()
  }
  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const result = await submit(AUTH_API.scheduleDeletion, {
      password: fields.get('password'), confirmed: fields.get('confirmed') === 'on',
    }, failure => { if (failure.status === 'session-changed') window.location.reload() }, { continuityToken: token })
    form.reset()
    if (result?.next) window.location.replace(result.next)
  }
  return <section className="student-surface border-student-error" aria-labelledby="delete-account-heading">
    <h2 id="delete-account-heading" className="student-section-title">Delete account</h2>
    <p className="mt-2 text-sm text-student-text-secondary">Schedule deletion of your account and student data after {ACCOUNT_DELETION_GRACE_DAYS} days.</p>
    <button ref={trigger} type="button" className={studentAction(btnGhost, 'mt-4 text-student-error')}
      onClick={() => open ? close() : setOpen(true)} disabled={pending}
      aria-expanded={open} aria-controls="delete-account-form">Delete my account</button>
    <div id="delete-account-form" hidden={!open}>
      {open && <form onSubmit={schedule} className="mt-4 grid gap-4">
        <div id="deletion-details" className="space-y-2 text-sm text-student-text-secondary">
          <p>You will be signed out on every device. Before the {ACCOUNT_DELETION_GRACE_DAYS}-day deadline, sign in and choose “Yes, keep my account” to cancel.</p>
          <p>After the deadline, you can’t sign in or restore your account, even if deletion has not finished. Your profile, bookmarks, practice history and question reports that identify you will be removed.</p>
          <p>If you used a Discovery Pass, a protected record of your email address is kept without your account for up to {DISCOVERY_CLAIM_RETENTION_MONTHS} months, so the same address cannot start another pass in that time. A used free trial or Early Access place stays used.</p>
          <p>Our service providers may retain some records and backups under their policies or legal obligations. Contact support for details.</p>
        </div>
        <FormField id="delete-current-password" name="password" label="Current password" type="password"
          autoComplete="current-password" required maxLength={PASSWORD_MAX_LENGTH} disabled={pending} aria-describedby="deletion-details" autoFocus />
        <label className="flex min-h-11 items-start gap-3 text-sm text-student-text-primary">
          <input name="confirmed" type="checkbox" required disabled={pending} className="student-focus-control mt-1 h-5 w-5 shrink-0" />
          <span>I understand that deletion becomes permanent after {ACCOUNT_DELETION_GRACE_DAYS} days.</span>
        </label>
        {error && <Feedback tone="error" message={error} />}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} aria-busy={pending} className={studentAction(btnNavy)}>
            {pending ? 'Scheduling…' : 'Schedule account deletion'}
          </button>
          <button type="button" disabled={pending} onClick={close} className={studentAction(btnGhost)}>Go back</button>
        </div>
      </form>}
    </div>
  </section>
}
