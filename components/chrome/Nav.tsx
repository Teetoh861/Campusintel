// Shared navigation: compact drawer on phone, direct study links plus a
// utility drawer on tablet, and expanded links/actions on desktop.
'use client'

import { onStudentChange } from '@/lib/auth/client-events'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AUTH_API, AUTH_STATUS_EVENT } from '@/lib/auth/constants'
import { useLogoutAction } from '@/components/auth/LogoutButton'
import { AuthNavActions } from '@/components/auth/AuthNavActions'
import { BookLogo, Wordmark } from './Logo'
import { btnAccent, btnBase, btnSm, btnWhite, cx } from './ui'

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

export function Nav({ variant = 'blue' }: Props) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)
  const [auth, setAuth] = useState<{ enabled: boolean; signedIn: boolean } | null>(null)
  const logout = useLogoutAction()

  useEffect(() => {
    let controller: AbortController | undefined
    let active = true
    const refresh = async () => {
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      try {
        const response = await fetch(AUTH_API.session, { cache: 'no-store', credentials: 'same-origin', signal })
        const state: unknown = await response.json()
        if (!response.ok || !state || typeof state !== 'object' || !('enabled' in state) ||
            !('signedIn' in state) || typeof state.enabled !== 'boolean' || typeof state.signedIn !== 'boolean') {
          throw new Error('Invalid auth status')
        }
        if (active && !signal.aborted) setAuth({ enabled: state.enabled, signedIn: state.signedIn })
      } catch {
        // A failed lookup cannot confirm sign-out or a disabled rollout.
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    const unsubscribe = onStudentChange(refresh)
    void refresh()
    window.addEventListener('focus', visible)
    window.addEventListener(AUTH_STATUS_EVENT, visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      unsubscribe()
      controller?.abort()
      window.removeEventListener('focus', visible)
      window.removeEventListener(AUTH_STATUS_EVENT, visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])

  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1200px)')
    const closeAtDesktop = () => { if (desktop.matches) setOpen(false) }
    desktop.addEventListener('change', closeAtDesktop)
    return () => desktop.removeEventListener('change', closeAtDesktop)
  }, [])

  const accountControls = auth?.enabled !== false
  const identity = auth === null ? null : auth.signedIn

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

  const drawerLink = (link: (typeof NAV_LINKS)[number], study: boolean) => {
    const active = isCurrent(pathname, link.href)
    return <Link
      key={link.href}
      href={link.href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex min-h-11 items-center rounded-ci-btn-sm px-3 text-[15px] font-semibold transition-colors',
        study && 'tablet:hidden',
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
    <nav className="sticky top-0 z-[60] bg-student-navigation text-student-navigation-text" data-screen-label="Nav"
      data-variant={variant} aria-label="Primary">
      <div className={WRAP}>
        <div className="flex h-14 items-center gap-2 tablet:h-16 tablet:gap-3 desktop:h-[72px] desktop:gap-4">
          <Link href="/" className={cx('inline-flex min-h-11 shrink-0 items-center gap-2 rounded-ci-btn-sm',
            FOCUS_ON_BLUE)} aria-label="CampusIntel home" onClick={close}>
            <BookLogo size={30} />
            <Wordmark className="hidden text-[17px] min-[360px]:inline tablet:text-[19px]" />
          </Link>

          <div className="ml-auto hidden items-center gap-1 tablet:flex desktop:hidden">
            {STUDY_LINKS.map(topLink)}
          </div>
          <div className="ml-auto hidden items-center gap-1 desktop:flex">
            {NAV_LINKS.map(topLink)}
          </div>

          {accountControls ? <div className="ml-1 hidden w-64 desktop:block">
            <AuthNavActions signedIn={identity} surface="blue" onNavigate={close} logout={logout} />
          </div> : <Link className={cx(btnBase, btnSm, btnWhite, 'ml-1 hidden desktop:inline-flex')}
            href="/courses">Browse courses</Link>}

          <button type="button" ref={menuButton}
            className={cx('ml-auto inline-flex h-11 w-11 shrink-0 flex-col items-center justify-center gap-[5px] rounded-ci-btn-sm hover:bg-student-navigation-hover tablet:ml-1 desktop:hidden',
              FOCUS_ON_BLUE)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-controls="site-navigation-menu"
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}
          >
            <span className={cx('h-[2px] w-[22px] rounded-sm bg-student-navigation-text transition-transform duration-150 motion-reduce:transition-none',
              open && 'translate-y-[7px] rotate-45')} />
            <span className={cx('h-[2px] w-[22px] rounded-sm bg-student-navigation-text transition-opacity duration-150 motion-reduce:transition-none',
              open && 'opacity-0')} />
            <span className={cx('h-[2px] w-[22px] rounded-sm bg-student-navigation-text transition-transform duration-150 motion-reduce:transition-none',
              open && '-translate-y-[7px] -rotate-45')} />
          </button>
        </div>
      </div>

      <div id="site-navigation-menu"
        className={cx('border-t border-student-navigation-divider bg-student-surface text-student-text desktop:hidden',
          open ? 'block' : 'hidden')}
        onKeyDown={event => { if (event.key === 'Escape') { close(); menuButton.current?.focus() } }}>
        <div className={cx(WRAP,
          'grid gap-3 py-3 tablet:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tablet:gap-6 tablet:py-4')}>
          <div>
            {STUDY_LINKS.map(link => drawerLink(link, true))}
            {UTILITY_LINKS.map(link => drawerLink(link, false))}
          </div>
          <div className="grid content-start gap-2">
            {accountControls && <AuthNavActions signedIn={identity} surface="paper"
              onNavigate={close} logout={logout} />}
            <Link className={cx(btnBase, btnSm, btnAccent, 'w-full')}
              href="/materials" onClick={close}>Request material privately</Link>
          </div>
        </div>
      </div>
    </nav>
  )
}
