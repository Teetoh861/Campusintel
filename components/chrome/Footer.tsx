// Shared footer. Compact, readable phone columns and bounded desktop width.
import Link from 'next/link'
import { CONTACT_EMAIL } from '@/lib/contact'
import { BookLogo, Wordmark } from './Logo'

const WRAP = 'app-container'

const linkClass =
  'inline-flex min-h-11 items-center text-[13.5px] font-medium leading-5 text-student-text-secondary transition-colors hover:text-student-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-focus tablet:text-[14px]'

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-student-border bg-student-page-surface" data-screen-label="Footer">
      <div className={`${WRAP} pb-6 pt-6 tablet:pb-9 tablet:pt-10 desktop:pt-12`}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 tablet:grid-cols-[2fr_1fr_1fr] tablet:gap-8">
          <div className="col-span-2 min-w-0 tablet:col-span-1">
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
          </div>

          <div className="min-w-0">
            <h2 className="mb-1 text-[12px] font-bold uppercase tracking-[0.1em] text-student-text-muted tablet:mb-2">
              Explore
            </h2>
            <ul>
              <li><Link href="/courses" className={linkClass}>Courses</Link></li>
              <li><Link href="/tutors" className={linkClass}>Tutoring</Link></li>
              <li><Link href="/bookmarks" className={linkClass}>Bookmarks</Link></li>
            </ul>
          </div>

          <div className="min-w-0">
            <h2 className="mb-1 text-[12px] font-bold uppercase tracking-[0.1em] text-student-text-muted tablet:mb-2">
              Contact
            </h2>
            <ul>
              <li>
                <Link href="/contact" className={linkClass}>Contact</Link>
              </li>
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className={`${linkClass} break-all tablet:break-normal`}
                >
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li><Link href="/become-a-tutor" className={linkClass}>Apply to tutor</Link></li>
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
