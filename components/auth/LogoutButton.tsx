// components/auth/LogoutButton.tsx — Current-session logout via same-origin POST.
'use client'
import { btnBase, btnSm, btnWhite, cx } from '@/components/chrome/ui'
import { AUTH_API, AUTH_PATHS } from '@/lib/auth/constants'
import { useAuthSubmit } from './useAuthSubmit'
import { Feedback } from '@/components/chrome/Feedback'

/** Share one pending logout operation across responsive controls. */
export function useLogoutAction() {
  const { submit, pending, error } = useAuthSubmit()
  return { pending, error, logout: async () => {
    if (await submit(AUTH_API.logout, {})) {
      window.location.replace(AUTH_PATHS.login)
    }
  } }
}

/** Present a logout action without changing its dimensions while pending. */
export function LogoutControl({ action, className, inNav = false }: {
  action: ReturnType<typeof useLogoutAction>; className?: string; inNav?: boolean
}) {
  return <div className={inNav ? 'relative h-11 w-full' : undefined}>
    <button type="button" disabled={action.pending} aria-busy={action.pending}
      className={cx(btnBase, btnSm, className ?? btnWhite, 'disabled:opacity-60')}
      onClick={action.logout}>Log out</button>
    {action.error && <div className={inNav ? 'absolute right-0 top-full z-10 mt-2 w-64' : undefined}>
      <Feedback message={action.error} tone="error" />
    </div>}
  </div>
}

/** Standalone account logout retains the same server operation. */
export function LogoutButton() {
  const action = useLogoutAction()
  return <LogoutControl action={action} />
}
