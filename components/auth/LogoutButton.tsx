// components/auth/LogoutButton.tsx — Current-session logout via same-origin POST.
'use client'
import { btnBase, buttonClassName, btnSm, btnWhite } from '@/components/chrome/ui'
import { AUTH_API, AUTH_PATHS } from '@/lib/auth/constants'
import { useAuthSubmit } from './useAuthSubmit'
import { Feedback } from '@/components/chrome/Feedback'
import { useRef } from 'react'
import { useNavigationSession } from './NavigationSession'
import type { ReactElement } from 'react'

/** Share one pending logout operation across responsive controls. */
export function useLogoutAction(renderedToken?: string) {
  const { submit, pending, error } = useAuthSubmit()
  const navigation = useNavigationSession()
  const token = renderedToken ?? navigation.continuityToken
  return { pending: pending || !token, error, logout: async () => {
    if (!token) return
    if (await submit(AUTH_API.logout, {}, failure => {
      if (failure.status === 'session-changed') window.location.reload()
    }, { continuityToken: token })) {
      window.location.replace(AUTH_PATHS.login)
    }
  } }
}

/** Present a logout action without changing its dimensions while pending. */
export function LogoutControl({ action, className, inNav = false }: {
  action: ReturnType<typeof useLogoutAction>; className?: string; inNav?: boolean
}): ReactElement {
  return <div className={inNav ? 'relative h-11 w-full' : undefined}>
    <button type="button" disabled={action.pending} aria-busy={action.pending}
      className={buttonClassName(btnBase, btnSm, className ?? btnWhite, 'disabled:opacity-60')}
      onClick={action.logout}>Log out</button>
    {action.error && <div className={inNav ? 'absolute right-0 top-full z-10 mt-2 w-64' : undefined}>
      <Feedback message={action.error} tone="error" />
    </div>}
  </div>
}

/** Standalone account logout retains the same server operation. */
export function LogoutButton({ continuityToken }: { continuityToken: string }) {
  const pageToken = useRef(continuityToken).current
  const action = useLogoutAction(pageToken)
  return <LogoutControl action={action} />
}
