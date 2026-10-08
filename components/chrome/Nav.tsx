// components/chrome/Nav.tsx — Public account entry and stable, accessible student navigation.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLogoutAction } from '@/components/auth/LogoutButton'
import { useNavigationSession } from '@/components/auth/NavigationSession'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { isStudentDestinationActive, STUDENT_NAVIGATION_GROUPS } from '@/lib/product/student-navigation'
import { STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { studentFocusDark, studentFocusRow, studentFocusControl } from '@/components/student/ui'
import { BrandMark, Wordmark } from './Logo'
import { NavigationAccountControls } from './NavigationAccountControls'
import { cx } from './ui'
import type { StudentDestination } from '@/lib/product/student-navigation'
import type { ReactElement } from 'react'

const WRAP = 'app-container'
const DESKTOP_QUERY = '(min-width: 1200px)'
const FOCUS_ON_BLUE = studentFocusDark
const FOCUS_ON_PAPER = studentFocusRow

type Props = {
  variant?: 'blue' | 'cream'
}

/** Keep public entry minimal and present authenticated navigation without moving page content. */
export function Nav({ variant = 'blue' }: Props): ReactElement {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const { signedIn, version } = useNavigationSession()
  const logout = useLogoutAction()

  useEffect(() => { setOpen(false) }, [pathname, version])
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY)
    const closeAtDesktop = () => { if (desktop.matches) setOpen(false) }
    desktop.addEventListener('change', closeAtDesktop)
    return () => desktop.removeEventListener('change', closeAtDesktop)
  }, [])

  const topLink = (link: StudentDestination) => {
    const active = isStudentDestinationActive(pathname, link)
    return <Link
      key={link.id}
      href={link.href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'student-nav-link inline-flex min-h-11 items-center rounded-ci-btn-sm px-2 text-[14px] font-semibold transition-colors',
        active ? 'bg-student-navigation-current text-student-navigation-text' :
          'text-student-navigation-text-muted hover:bg-student-navigation-hover hover:text-student-navigation-text',
        FOCUS_ON_BLUE,
      )}
    >
      {link.label}
    </Link>
  }

  const drawerLink = (link: StudentDestination) => {
    const active = isStudentDestinationActive(pathname, link)
    return <Link
      key={link.id}
      href={link.href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'student-nav-row flex min-h-12 items-center rounded-ci-btn-sm px-3 text-[16px] font-semibold transition-colors',
        active ? 'bg-student-brand-surface text-student-primary' :
          'text-student-text hover:bg-student-surface-muted',
        FOCUS_ON_PAPER,
      )}
      onClick={close}
    >
      {link.label}
    </Link>
  }

  return (
    <Sheet open={signedIn && open} onOpenChange={setOpen}>
      <nav className="sticky top-0 z-[60] bg-student-navigation text-student-navigation-text" data-screen-label="Nav"
        data-variant={variant} aria-label="Primary">
        <div className={signedIn ? `${WRAP} student-workspace` : WRAP}>
          <div className="flex h-[var(--student-header-height)] items-center gap-2 tablet:gap-3 desktop:gap-4">
            <Link href={signedIn ? STUDENT_HOME_PATH : '/'} prefetch={false} className={cx('inline-flex min-h-11 shrink-0 items-center gap-2 rounded-ci-btn-sm',
              FOCUS_ON_BLUE)} aria-label="CampusIntell home" aria-current={signedIn && pathname === STUDENT_HOME_PATH ? 'page' : undefined} onClick={close}>
              <BrandMark size={30} />
              <Wordmark tone="white" />
            </Link>

            {signedIn && <div className="ml-auto hidden items-center gap-1 desktop:flex">
              {STUDENT_NAVIGATION_GROUPS.desktop.map(topLink)}
            </div>}

            {!signedIn && <div className="ml-auto">
              <NavigationAccountControls signedIn={false} surface="blue" onNavigate={close} logout={logout} />
            </div>}

            {signedIn && <SheetTrigger asChild><button type="button"
              className={cx('ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-ci-btn-sm border border-student-navigation-divider hover:bg-student-navigation-hover desktop:hidden',
                FOCUS_ON_BLUE)}
              aria-label="Open menu"
            >
              <span aria-hidden="true" className="flex flex-col gap-1">
                <span className="h-[2px] w-4 bg-student-navigation-text" />
                <span className="h-[2px] w-4 bg-student-navigation-text" />
                <span className="h-[2px] w-4 bg-student-navigation-text" />
              </span>
            </button></SheetTrigger>}
          </div>
        </div>
      </nav>
      {signedIn && <SheetContent side="right"
        className="z-[80] h-dvh w-full max-w-sm overflow-y-auto overscroll-contain border-student-border bg-student-surface px-5 py-6 text-student-text shadow-ci-card"
        overlayClassName="z-[70] bg-student-scrim"
        closeClassName={cx('right-3 top-3 flex h-11 w-11 items-center justify-center rounded-ci-btn-sm text-student-primary opacity-100 hover:bg-student-brand-surface focus:ring-0', studentFocusControl)}>
        <SheetTitle className="pr-12 text-xl font-bold text-student-text-primary">Navigation</SheetTitle>
        <SheetDescription className="mt-2 pr-10 text-sm text-student-text-secondary">
          Your study space and account.
        </SheetDescription>
        <div className="mt-6">
          {STUDENT_NAVIGATION_GROUPS.menu.map(drawerLink)}
        </div>
      </SheetContent>}
    </Sheet>
  )
}
