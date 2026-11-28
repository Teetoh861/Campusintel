// components/auth/AuthNavActions.tsx — Account-entry and logout actions; product links belong to chrome.
'use client'
import Link from 'next/link'
import { AUTH_PATHS } from '@/lib/auth/constants'
import { btnAccent, btnBase, buttonClassName, btnGhost, btnGhostOnBlue, btnSm, focusRingNavy } from '@/components/chrome/ui'
import { LogoutControl } from './LogoutButton'
import type { useLogoutAction } from './LogoutButton'
import type { ReactElement } from 'react'

export type AuthNavActionsProps = {
  signedIn: boolean; surface: 'blue' | 'paper'; onNavigate: () => void
  logout: ReturnType<typeof useLogoutAction>
  logoutClassName?: string
}

/** Present only account-entry or logout actions, using the existing server operation. */
export function AuthNavActions({ signedIn, surface, onNavigate, logout, logoutClassName }: AuthNavActionsProps): ReactElement {
  const secondary = surface === 'blue' ? btnGhostOnBlue : btnGhost
  const focus = surface === 'blue'
    ? 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:!outline-student-focus-inverse'
    : focusRingNavy
  if (!signedIn) return <div className="flex shrink-0 items-center gap-1.5 tablet:gap-2">
    <Link onClick={onNavigate} prefetch={false} href={AUTH_PATHS.login}
      className={buttonClassName(btnBase, btnSm, secondary, 'whitespace-nowrap px-2 tablet:px-4', focus)}>Sign in</Link>
    <Link onClick={onNavigate} href={AUTH_PATHS.register}
      className={buttonClassName(btnBase, btnSm, btnAccent, 'whitespace-nowrap px-2 tablet:px-4', focus)}>Create account</Link>
  </div>

  return <LogoutControl action={logout} inNav className={logoutClassName} />
}
