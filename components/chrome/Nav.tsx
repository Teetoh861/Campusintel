// Nav — Variant B "continuous blue" global header. Solid ci-navy bar (no
// blur, no bottom border) that reads as one field with the homepage hero.
// White logo + links, a white "Browse courses" button on desktop, and a
// hamburger + paper drawer on mobile. Student state is fetched as booleans only.
// (component-spec.md → Nav)
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AUTH_API, AUTH_PATHS, AUTH_STATUS_EVENT } from '@/lib/auth/constants'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { BookLogo, Wordmark } from './Logo'
import { btnAccent, btnBase, btnNavy, btnSm, btnWhite, cx } from './ui'

const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/courses', label: 'Courses' },
  { href: '/bookmarks', label: 'Bookmarks' },
  { href: '/tutors', label: 'Tutors' },
  { href: '/contact', label: 'Contact' },
]

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

type Props = {
  variant?: 'blue' | 'cream'
}

export function Nav({ variant = 'blue' }: Props) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const [auth, setAuth] = useState({ enabled: false, signedIn: false })
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
        if (active && !signal.aborted) setAuth({ enabled: false, signedIn: false })
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    window.addEventListener('focus', visible)
    window.addEventListener(AUTH_STATUS_EVENT, visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      controller?.abort()
      window.removeEventListener('focus', visible)
      window.removeEventListener(AUTH_STATUS_EVENT, visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  const accountControls = auth.enabled && <>
    <Link href={auth.signedIn ? AUTH_PATHS.account : AUTH_PATHS.login}
      onClick={close} className={cx(btnBase, btnSm, btnWhite)}>{auth.signedIn ? 'Account' : 'Sign in'}</Link>
    {auth.signedIn ? <LogoutButton /> : <Link href={AUTH_PATHS.register}
      onClick={close} className={cx(btnBase, btnSm, btnAccent)}>Create account</Link>}
  </>

  return (
    <nav className="sticky top-0 z-[60] bg-ci-navy" data-screen-label="Nav" data-variant={variant}>
      <div className={WRAP}>
        <div className="flex h-[74px] items-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-3 text-white"
            aria-label="CampusIntel home"
            onClick={close}
          >
            <BookLogo size={34} />
            <Wordmark className="text-[20px]" />
          </Link>

          <div className={cx('hidden items-center min-[900px]:flex', auth.enabled ? 'ml-2 gap-4' : 'ml-5 gap-[34px]')}>
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[15.5px] font-medium text-white/[0.84] transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-[14px]">
            {auth.enabled ? <div className="hidden items-center gap-2 min-[900px]:flex">{accountControls}</div> : <Link
              className={cx(btnBase, btnSm, btnWhite, 'hidden min-[900px]:inline-flex')}
              href="/courses"
            >
              Browse courses
            </Link>}
            <button
              type="button"
              className="-mr-[10px] inline-flex h-[46px] w-[46px] flex-col items-center justify-center gap-[5px] min-[900px]:hidden"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <span
                className={cx(
                  'h-[2px] w-[22px] rounded-[2px] bg-white transition-transform duration-200',
                  open && 'translate-y-[7px] rotate-45',
                )}
              />
              <span
                className={cx(
                  'h-[2px] w-[22px] rounded-[2px] bg-white transition-opacity duration-200',
                  open && 'opacity-0',
                )}
              />
              <span
                className={cx(
                  'h-[2px] w-[22px] rounded-[2px] bg-white transition-transform duration-200',
                  open && '-translate-y-[7px] -rotate-45',
                )}
              />
            </button>
          </div>
        </div>
      </div>

      <div className={cx('border-t border-ci-border bg-ci-paper min-[900px]:hidden', open ? 'block' : 'hidden')}>
        <div className={WRAP}>
          <div className="pb-4 pt-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block min-h-11 border-b border-ci-border py-2.5 text-[16px] font-semibold leading-6 text-ci-ink"
                onClick={close}
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2">
              {accountControls}
              <Link className={cx(btnBase, btnSm, btnNavy, 'w-full')} href="/courses" onClick={close}>
                Browse courses
              </Link>
              <Link
                className={cx(btnBase, btnSm, btnAccent, 'w-full')}
                href="/materials"
                onClick={close}
              >
                Request materials
              </Link>
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}
