// components/auth/AuthNavActions.tsx — Shared responsive auth actions within the existing header width.
'use client'
import Link from 'next/link'
import { AUTH_PATHS, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { btnAccent, btnBase, buttonClassName, btnGhost, btnGhostOnBlue, btnSm, cx, focusRingNavy } from '@/components/chrome/ui'
import { LogoutControl } from './LogoutButton'
import type { useLogoutAction } from './LogoutButton'
import type { ReactElement } from 'react'

const SLOT = 'flex h-11 w-full !min-h-11 items-center justify-center'

/** Compact public entry actions or student account controls, using the same logout operation. */
export function AuthNavActions({ signedIn, surface, onNavigate, logout }: {
  signedIn: boolean; surface: 'blue' | 'paper'; onNavigate: () => void
  logout: ReturnType<typeof useLogoutAction>
}): ReactElement {
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

  return <div className={cx('grid gap-2', surface === 'blue' ? 'grid-cols-[auto_auto_auto] items-center' : 'grid-cols-2')}>
    <Link onClick={onNavigate} prefetch={false} href={STUDENT_HOME_PATH}
      className={buttonClassName(btnBase, btnSm, secondary, SLOT, 'px-3', surface === 'paper' && 'col-span-2', focus)}>
      Dashboard
    </Link>
    <Link onClick={onNavigate} prefetch={false} href={AUTH_PATHS.account}
      className={buttonClassName(btnBase, btnSm, secondary, SLOT, 'px-3', focus)}>Account</Link>
    <LogoutControl action={logout} inNav
      className={cx(secondary, SLOT, 'px-3', focus)} />
  </div>
}
