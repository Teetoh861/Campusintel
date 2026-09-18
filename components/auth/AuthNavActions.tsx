// components/auth/AuthNavActions.tsx — Shared responsive auth matrix with two stable action slots.
'use client'
import Link from 'next/link'
import { AUTH_PATHS } from '@/lib/auth/constants'
import { btnAccent, btnBase, btnGhost, btnGhostOnBlue, btnSm, cx } from '@/components/chrome/ui'
import { LogoutControl, type useLogoutAction } from './LogoutButton'

const SLOT = 'flex h-11 w-full !min-h-11 items-center justify-center'

/** Null identity reserves empty slots until the first session result is confirmed. */
export function AuthNavActions({ signedIn, surface, onNavigate, logout }: {
  signedIn: boolean | null; surface: 'blue' | 'paper'; onNavigate: () => void
  logout: ReturnType<typeof useLogoutAction>
}) {
  const secondary = surface === 'blue' ? btnGhostOnBlue : btnGhost
  return <div className="grid w-64 shrink-0 grid-cols-5 gap-2" aria-busy={signedIn === null}>
    <div className="col-span-2 h-11">
      {signedIn !== null && <Link onClick={onNavigate} href={signedIn ? AUTH_PATHS.account : AUTH_PATHS.login}
        className={cx(btnBase, btnSm, secondary, SLOT)}>{signedIn ? 'Account' : 'Sign in'}</Link>}
    </div>
    <div className="col-span-3 h-11">
      {signedIn !== null && (signedIn ? <LogoutControl action={logout} inNav
        className={cx(surface === 'blue' ? 'text-ci-paper hover:bg-ci-navy-700' : 'text-ci-navy hover:bg-ci-blue-50', SLOT)} /> :
        <Link onClick={onNavigate} href={AUTH_PATHS.register}
          className={cx(btnBase, btnSm, btnAccent, SLOT)}>Create account</Link>)}
    </div>
  </div>
}
