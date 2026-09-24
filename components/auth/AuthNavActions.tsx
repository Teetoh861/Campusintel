// components/auth/AuthNavActions.tsx — Shared responsive auth actions within the existing header width.
'use client'
import Link from 'next/link'
import { AUTH_PATHS, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { AUTH_FOCUS } from '@/components/chrome/FormField'
import { btnAccent, btnBase, btnGhost, btnGhostOnBlue, btnSm, cx } from '@/components/chrome/ui'
import { LogoutControl, type useLogoutAction } from './LogoutButton'

const SLOT = 'flex h-11 w-full !min-h-11 items-center justify-center'

/** Null identity reserves empty slots until the first session result is confirmed. */
export function AuthNavActions({ signedIn, surface, onNavigate, logout }: {
  signedIn: boolean | null; surface: 'blue' | 'paper'; onNavigate: () => void
  logout: ReturnType<typeof useLogoutAction>
}) {
  const secondary = surface === 'blue' ? btnGhostOnBlue : btnGhost
  const focus = surface === 'blue'
    ? 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-white'
    : AUTH_FOCUS
  return <div className="grid w-64 shrink-0 grid-cols-5 gap-2" aria-busy={signedIn === null}>
    <div className="col-span-2 h-11">
      {signedIn !== null && <Link onClick={onNavigate} prefetch={false}
        href={signedIn ? STUDENT_HOME_PATH : AUTH_PATHS.login}
        className={cx(btnBase, btnSm, secondary, SLOT, signedIn && '!px-2 text-[13px]', focus)}>
        {signedIn ? 'Dashboard' : 'Sign in'}
      </Link>}
    </div>
    <div className="col-span-3 h-11">
      {signedIn === true ? <div className="flex h-11 items-center gap-1">
        <Link onClick={onNavigate} prefetch={false} href={AUTH_PATHS.account}
          className={cx('inline-flex h-11 shrink-0 items-center px-1 text-[13px] font-semibold',
            surface === 'blue' ? 'text-ci-paper hover:text-white' : 'text-ci-navy hover:bg-ci-blue-50', focus)}>
          Account
        </Link>
        <div className="min-w-0 flex-1"><LogoutControl action={logout} inNav
          className={cx(surface === 'blue' ? 'text-ci-paper hover:bg-ci-navy-700' : 'text-ci-navy hover:bg-ci-blue-50',
            SLOT, '!px-2 text-[13px]', focus)} /></div>
      </div> : signedIn === false ?
        <Link onClick={onNavigate} href={AUTH_PATHS.register}
          className={cx(btnBase, btnSm, btnAccent, SLOT, focus)}>Create account</Link> : null}
    </div>
  </div>
}
