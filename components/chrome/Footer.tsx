// Footer — Variant B. Paper surface, top hairline border. Navy book mark
// (amber bookmark stays), wordmark + tagline, an Explore column and a Contact
// column, then a bottom bar. Server Component; the copyright year is computed
// at render time. Contact email is sourced from lib/contact.ts. (spec → Footer)
import Link from 'next/link'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import { CONTACT_EMAIL } from '@/lib/contact'
import { BookLogo, Wordmark } from './Logo'

const WHATSAPP_URL = buildWhatsAppUrl('Hello, I need help with CampusIntel')

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

const linkClass =
  'block py-1.5 text-[11.5px] font-medium leading-[1.35] text-ci-gray-600 transition-colors hover:text-ci-navy min-[680px]:py-0 min-[680px]:text-[15px] min-[680px]:leading-normal'

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-ci-border bg-ci-paper" data-screen-label="Footer">
      {/* .wrap padding per spec: 56px top / gutter sides / 40px bottom, so the
          bottom bar keeps proper breathing room above the footer edge. */}
      <div className={`${WRAP} pb-6 pt-8 min-[680px]:pb-10 min-[680px]:pt-14`}>
        <div className="grid grid-cols-3 gap-2 min-[680px]:grid-cols-[2fr_1fr_1fr] min-[680px]:gap-10">
          <div className="min-w-0">
            <Link
              href="/"
              className="flex flex-col items-start gap-1 text-ci-navy min-[680px]:inline-flex min-[680px]:flex-row min-[680px]:items-center min-[680px]:gap-3"
              aria-label="CampusIntel home"
            >
              <BookLogo size={32} className="h-6 w-6 min-[680px]:h-8 min-[680px]:w-8" />
              <Wordmark className="text-[12px] text-ci-navy-900 min-[680px]:text-[19px]" />
            </Link>
            <p className="mt-2 max-w-[32ch] text-[10.5px] leading-[1.35] text-ci-gray-600 min-[680px]:mt-4 min-[680px]:text-[14.5px] min-[680px]:leading-[1.6]">
              Academic intelligence for the University of Lagos.
            </p>
          </div>

          <div className="min-w-0">
            <h5 className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ci-gray-500 min-[680px]:mb-4 min-[680px]:text-[12.5px] min-[680px]:tracking-[0.13em]">
              Explore
            </h5>
            <ul className="flex flex-col gap-0 min-[680px]:gap-3">
              <li><Link href="/courses" className={linkClass}>Courses</Link></li>
              <li><Link href="/tutors" className={linkClass}>Tutoring</Link></li>
              <li><Link href="/bookmarks" className={linkClass}>Bookmarks</Link></li>
            </ul>
          </div>

          <div className="min-w-0">
            <h5 className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ci-gray-500 min-[680px]:mb-4 min-[680px]:text-[12.5px] min-[680px]:tracking-[0.13em]">
              Contact
            </h5>
            <ul className="flex flex-col gap-0 min-[680px]:gap-3">
              <li>
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  WhatsApp
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className={`${linkClass} break-all min-[680px]:break-normal`}
                >
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li><Link href="/become-a-tutor" className={linkClass}>Apply to tutor</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-ci-border pt-4 min-[680px]:mt-11 min-[680px]:gap-[14px] min-[680px]:pt-6">
          <span className="text-[11px] text-ci-gray-500 min-[680px]:text-[13.5px]">© {year} CampusIntel</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.03em] text-ci-gray-600 min-[680px]:gap-2 min-[680px]:text-[13px] min-[680px]:tracking-[0.04em]">
            <span className="h-[6px] w-[6px] rounded-full bg-ci-accent" />
            University of Lagos
          </span>
        </div>
      </div>
    </footer>
  )
}
