// components/chrome/Footer.tsx — Public support footer with application links for verified students.
'use client'

import Link from 'next/link'
import { CONTACT_EMAIL } from '@/lib/contact'
import { useNavigationSession } from '@/components/auth/NavigationSession'
import { STUDENT_FOOTER_GROUPS } from '@/lib/product/student-navigation'
import { BookLogo, Wordmark } from './Logo'
import type { ReactElement } from 'react'

const WRAP = 'app-container'

const linkClass =
  'inline-flex min-h-11 items-center text-[13.5px] font-medium leading-5 text-student-text-secondary transition-colors hover:text-student-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-focus tablet:text-[14px]'

/** Keep anonymous global navigation focused on account entry and public support. */
export function Footer({ year }: { year: number }): ReactElement {
  const { signedIn } = useNavigationSession()
  const supportEmail = <a href={`mailto:${CONTACT_EMAIL}`}
    className={`${linkClass} max-w-full break-words [overflow-wrap:anywhere]`}>{CONTACT_EMAIL}</a>
  return (
    <footer className="border-t border-student-border bg-student-page-surface" data-screen-label="Footer">
      <div className={`${WRAP} pb-6 pt-6 tablet:pb-9 tablet:pt-10 desktop:pt-12`}>
        <div className={signedIn ? 'grid grid-cols-2 gap-5 tablet:grid-cols-[2fr_1fr_1.5fr] tablet:gap-8' : 'grid gap-5 tablet:grid-cols-[2fr_1fr] tablet:gap-8'}>
          <div className={signedIn ? 'col-span-2 min-w-0 tablet:col-span-1' : 'min-w-0'}>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-2 text-student-navigation focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-focus"
              aria-label="CampusIntel home"
            >
              <BookLogo size={32} className="h-7 w-7" />
              <Wordmark className="text-[17px] text-student-text-primary tablet:text-[19px]" />
            </Link>
            <p className="mt-1 max-w-[32ch] text-[13.5px] leading-5 text-student-text-secondary tablet:mt-3 tablet:text-[14px]">
              Academic intelligence for the University of Lagos.
            </p>
            {signedIn && <div className="mt-2">{supportEmail}</div>}
          </div>

          {signedIn && <div className="min-w-0">
            <h2 className="mb-1 text-[12px] font-bold uppercase tracking-[0.1em] text-student-text-muted tablet:mb-2">
              Explore
            </h2>
            <ul>
              {STUDENT_FOOTER_GROUPS.explore.map(({ destination, label }) =>
                <li key={destination.id}><Link href={destination.href} className={linkClass}>{label}</Link></li>)}
            </ul>
          </div>}

          <div className="min-w-0">
            <h2 className="mb-1 text-[12px] font-bold uppercase tracking-[0.1em] text-student-text-muted tablet:mb-2">
              Support
            </h2>
            <ul>
              {signedIn && STUDENT_FOOTER_GROUPS.support.map(destination => <li key={destination.id}>
                <Link href={destination.href} className={linkClass}>{destination.label}</Link>
              </li>)}
              {!signedIn && <li>{supportEmail}</li>}
              {signedIn && <li><Link href="/become-a-tutor" className={linkClass}>Apply to tutor</Link></li>}
            </ul>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-student-border pt-4 tablet:mt-8 tablet:pt-5">
          <span className="text-[12px] text-student-text-muted tablet:text-[13px]">© {year} CampusIntel</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold text-student-text-secondary tablet:text-[13px]">
            <span className="h-[6px] w-[6px] rounded-full bg-student-accent" />
            University of Lagos
          </span>
        </div>
      </div>
    </footer>
  )
}
