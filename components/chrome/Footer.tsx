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

const linkClass = 'text-[15px] font-medium text-ci-gray-600 transition-colors hover:text-ci-navy'

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-ci-border bg-ci-paper" data-screen-label="Footer">
      <div className={WRAP}>
        <div className="grid grid-cols-1 gap-9 pb-10 pt-14 min-[680px]:grid-cols-[2fr_1fr_1fr] min-[680px]:gap-10">
          <div>
            <Link href="/" className="inline-flex items-center gap-3 text-ci-navy" aria-label="CampusIntel home">
              <BookLogo size={32} />
              <Wordmark className="text-[19px] text-ci-navy-900" />
            </Link>
            <p className="mt-4 max-w-[32ch] text-[14.5px] leading-[1.6] text-ci-gray-600">
              The inside track on every paper. Academic intelligence for the University of Lagos.
            </p>
          </div>

          <div>
            <h5 className="mb-4 text-[12.5px] font-bold uppercase tracking-[0.13em] text-ci-gray-500">
              Explore
            </h5>
            <ul className="flex flex-col gap-3">
              <li><Link href="/courses" className={linkClass}>Courses</Link></li>
              <li><Link href="/tutors" className={linkClass}>Tutoring</Link></li>
              <li><Link href="/bookmarks" className={linkClass}>Bookmarks</Link></li>
            </ul>
          </div>

          <div>
            <h5 className="mb-4 text-[12.5px] font-bold uppercase tracking-[0.13em] text-ci-gray-500">
              Contact
            </h5>
            <ul className="flex flex-col gap-3">
              <li>
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  WhatsApp
                </a>
              </li>
              <li><a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>{CONTACT_EMAIL}</a></li>
              <li><Link href="/become-a-tutor" className={linkClass}>Apply to tutor</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-11 flex flex-wrap items-center gap-[14px] border-t border-ci-border pt-6">
          <span className="text-[13.5px] text-ci-gray-500">© {year} CampusIntel</span>
          <span className="ml-auto inline-flex items-center gap-2 text-[13px] font-semibold tracking-[0.04em] text-ci-gray-600">
            <span className="h-[6px] w-[6px] rounded-full bg-ci-accent" />
            University of Lagos
          </span>
        </div>
      </div>
    </footer>
  )
}
