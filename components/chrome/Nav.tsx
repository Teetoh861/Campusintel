// Nav — Variant B "continuous blue" global header. Solid ci-navy bar (no
// blur, no bottom border) that reads as one field with the homepage hero.
// White logo + links, a white "Browse courses" button on desktop, and a
// hamburger + paper drawer on mobile. The drawer toggle owns the only state.
// (component-spec.md → Nav)
'use client'

import { useState } from 'react'
import Link from 'next/link'
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

          <div className="ml-5 hidden items-center gap-[34px] min-[900px]:flex">
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
            <Link
              className={cx(btnBase, btnSm, btnWhite, 'hidden min-[900px]:inline-flex')}
              href="/courses"
            >
              Browse courses
            </Link>
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
