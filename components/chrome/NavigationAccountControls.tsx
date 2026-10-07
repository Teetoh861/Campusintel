// components/chrome/NavigationAccountControls.tsx — Existing account-link composition around shared auth actions.
'use client'

import Link from 'next/link'
import { AuthNavActions } from '@/components/auth/AuthNavActions'
import { STUDENT_NAVIGATION_GROUPS } from '@/lib/product/student-navigation'
import { btnBase, btnGhost, btnGhostOnBlue, btnSm, buttonClassName, cx, focusRingNavy } from './ui'
import type { AuthNavActionsProps } from '@/components/auth/AuthNavActions'
import type { ReactElement } from 'react'

const SLOT = 'flex h-11 w-full !min-h-11 items-center justify-center'

/** Keep the current product-link order, action styling and responsive placement unchanged. */
export function NavigationAccountControls(props: Omit<AuthNavActionsProps, 'logoutClassName'>): ReactElement {
  const { signedIn, surface, onNavigate } = props
  if (!signedIn) return <AuthNavActions {...props} />

  const secondary = surface === 'blue' ? btnGhostOnBlue : btnGhost
  const focus = surface === 'blue'
    ? 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:!outline-student-focus-inverse'
    : focusRingNavy
  return <div className={cx('grid gap-2', surface === 'blue' ? 'grid-cols-[auto_auto_auto] items-center' : 'grid-cols-2')}>
    {STUDENT_NAVIGATION_GROUPS.account.map(destination => <Link key={destination.id}
      onClick={onNavigate} prefetch={false} href={destination.href}
      className={buttonClassName(btnBase, btnSm, secondary, SLOT, 'px-3',
        surface === 'paper' && destination.id === 'dashboard' && 'col-span-2', focus)}>
      {destination.label}
    </Link>)}
    <AuthNavActions {...props} logoutClassName={cx(secondary, SLOT, 'px-3', focus)} />
  </div>
}
