// components/student/WayBack.tsx — The one way back from a page that can't be shown: Dashboard when signed in, else the home page.
'use client'

import Link from 'next/link'
import { useNavigationSession } from '@/components/auth/NavigationSession'
import { btnNavy } from '@/components/chrome/ui'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { studentAction, studentFocusDark } from './ui'
import type { ReactElement } from 'react'

const HOME_PATH = '/'

/** Uses the header's own session answer, so it never disagrees with the navigation above it. */
export function WayBack(): ReactElement {
  const { signedIn } = useNavigationSession()
  const className = studentAction(btnNavy, studentFocusDark)
  return signedIn
    ? <Link href={STUDENT_DESTINATIONS.dashboard.href} prefetch={false} className={className}>
      Go to {STUDENT_DESTINATIONS.dashboard.label}
    </Link>
    : <Link href={HOME_PATH} prefetch={false} className={className}>Go to the home page</Link>
}
