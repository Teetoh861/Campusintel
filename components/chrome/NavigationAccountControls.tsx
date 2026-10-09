// components/chrome/NavigationAccountControls.tsx — Shared session actions for Student App chrome.
'use client'

import { AuthNavActions } from '@/components/auth/AuthNavActions'
import { btnGhost, btnGhostOnBlue, cx } from './ui'
import { studentFocusControl, studentFocusDark } from '@/components/student/ui'
import type { AuthNavActionsProps } from '@/components/auth/AuthNavActions'
import type { ReactElement } from 'react'

const SLOT = 'flex h-11 w-full !min-h-11 items-center justify-center'

/** Chrome composes session actions; product links are rendered from the canonical primary group. */
export function NavigationAccountControls(props: Omit<AuthNavActionsProps, 'logoutClassName'>): ReactElement {
  const { signedIn, surface } = props
  if (!signedIn) return <AuthNavActions {...props} />

  const secondary = surface === 'blue' ? btnGhostOnBlue : btnGhost
  return <AuthNavActions {...props} logoutClassName={cx(secondary, SLOT, 'px-3',
    surface === 'blue' ? studentFocusDark : studentFocusControl)} />
}
