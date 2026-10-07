// components/chrome/Nav.tsx — Public account entry and stable, accessible student navigation.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLogoutAction } from '@/components/auth/LogoutButton'
import { AuthNavActions } from '@/components/auth/AuthNavActions'
import { useNavigationSession } from '@/components/auth/NavigationSession'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { BookLogo, Wordmark } from './Logo'
import { cx } from './ui'
import type { ReactElement } from 'react'

const STUDY_LINKS = [
  { href: '/courses', label: 'Courses' },
  { href: '/bookmarks', label: 'Bookmarks' },
] as const

const UTILITY_LINKS = [
  { href: '/tutors', label: 'Tutors' },
  { href: '/contact', label: 'Contact' },
] as const

const NAV_LINKS = [...STUDY_LINKS, ...UTILITY_LINKS]
const WRAP = 'app-container'
const DESKTOP_QUERY = '(min-width: 1200px)'
const FOCUS_ON_BLUE =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-focus-inverse'
const FOCUS_ON_PAPER =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-focus'

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || (href === '/courses' && pathname.startsWith('/courses/'))
}

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

  const topLink = (link: (typeof NAV_LINKS)[number]) => {
    const active = isCurrent(pathname, link.href)
    return <Link
      key={link.href}
      href={link.href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'inline-flex min-h-11 items-center rounded-ci-btn-sm px-3 text-[15px] font-semibold transition-colors',
        active ? 'bg-student-navigation-current text-student-navigation-text' :
          'text-student-navigation-text-muted hover:bg-student-navigation-hover hover:text-student-navigation-text',
        FOCUS_ON_BLUE,
      )}
    >
      {link.label}
    </Link>
  }

  const drawerLink = (link: (typeof NAV_LINKS)[number]) => {
    const active = isCurrent(pathname, link.href)
    return <Link
      key={link.href}
      href={link.href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex min-h-11 items-center rounded-ci-btn-sm px-3 text-[15px] font-semibold transition-colors',
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
        <div className={WRAP}>
          <div className="flex h-[var(--student-header-height)] items-center gap-2 tablet:gap-3 desktop:gap-4">
            <Link href="/" className={cx('inline-flex min-h-11 shrink-0 items-center gap-2 rounded-ci-btn-sm',
              FOCUS_ON_BLUE)} aria-label="CampusIntel home" onClick={close}>
              <BookLogo size={30} />
              <Wordmark className="text-[17px] tablet:text-[19px]" />
            </Link>

            {signedIn && <div className="ml-auto hidden items-center gap-1 tablet:flex desktop:hidden">
              {STUDY_LINKS.map(topLink)}
            </div>}
            {signedIn && <div className="ml-auto hidden items-center gap-1 desktop:flex">
              {NAV_LINKS.map(topLink)}
            </div>}

            <div className={signedIn ? 'ml-1 hidden desktop:block' : 'ml-auto'}>
              <AuthNavActions signedIn={signedIn} surface="blue" onNavigate={close} logout={logout} />
            </div>

            {signedIn && <SheetTrigger asChild><button type="button"
              className={cx('ml-auto inline-flex h-11 w-11 shrink-0 flex-col items-center justify-center gap-[5px] rounded-ci-btn-sm hover:bg-student-navigation-hover tablet:ml-1 desktop:hidden',
                FOCUS_ON_BLUE)}
              aria-label="Open menu"
            >
              <span className="h-[2px] w-[22px] rounded-sm bg-student-navigation-text" />
              <span className="h-[2px] w-[22px] rounded-sm bg-student-navigation-text" />
              <span className="h-[2px] w-[22px] rounded-sm bg-student-navigation-text" />
            </button></SheetTrigger>}
          </div>
        </div>
      </nav>
      {signedIn && <SheetContent side="right"
        className="z-[80] h-dvh w-full max-w-sm overflow-y-auto overscroll-contain border-student-border bg-student-surface px-5 py-6 text-student-text shadow-ci-card"
        overlayClassName="z-[70] bg-student-scrim"
        closeClassName={cx('right-3 top-3 flex h-11 w-11 items-center justify-center rounded-ci-btn-sm text-student-primary opacity-100 hover:bg-student-brand-surface focus:ring-0', FOCUS_ON_PAPER)}>
        <SheetTitle className="pr-12 text-xl font-bold text-student-text-primary">Navigation</SheetTitle>
        <SheetDescription className="mt-2 pr-10 text-sm text-student-text-secondary">
          Your study space and account.
        </SheetDescription>
        <div className="mt-6 space-y-6">
          <div className="tablet:hidden">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-student-text-muted">Study</h3>
            {STUDY_LINKS.map(drawerLink)}
          </div>
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-student-text-muted">Your account</h3>
            <AuthNavActions signedIn surface="paper" onNavigate={close} logout={logout} />
          </div>
          <div className="border-t border-student-border pt-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-student-text-muted">Support</h3>
            {UTILITY_LINKS.map(drawerLink)}
          </div>
        </div>
      </SheetContent>}
    </Sheet>
  )
}
