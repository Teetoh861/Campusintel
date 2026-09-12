// components/auth/LogoutButton.tsx — Current-session logout via same-origin POST.
'use client'
import { btnBase, btnSm, btnWhite, cx } from '@/components/chrome/ui'
import { AUTH_API, AUTH_STATUS_EVENT } from '@/lib/auth/constants'
import { useAuthSubmit } from './useAuthSubmit'
import { AuthNotice } from './AuthNotice'

/** End only this session and refresh the view without persisting auth data. */
export function LogoutButton() {
  const { submit, pending, error } = useAuthSubmit()
  return <div>
    <button type="button" disabled={pending} className={cx(btnBase, btnSm, btnWhite, 'disabled:opacity-60')}
      onClick={async () => { if (await submit(AUTH_API.logout, {})) {
        window.dispatchEvent(new Event(AUTH_STATUS_EVENT))
        window.location.reload()
      } }}>{pending ? 'Logging out…' : 'Log out'}</button>
    {error && <AuthNotice message={error} error />}
  </div>
}
