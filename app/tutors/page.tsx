// Tutors (/tutors) — Peer tutoring is not open yet: the cover says so once, and the card holds the two things a
// student can do, join the waitlist or apply to tutor. The WhatsApp URL is built once at request-time from the env helper.
import Link from 'next/link'
import { BlueCover } from '@/components/chrome/BlueCover'
import { btnAccent, btnBase, btnNavy, cx } from '@/components/chrome/ui'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

import type { ReactElement } from 'react'

// Per-request, so a signed-in student's header is right from the first render.
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tutors | CampusIntell' }

const WRAP = 'app-container'
const WAITLIST_MESSAGE = 'I’d like to join the CampusIntell tutoring waitlist.'

/** Render the existing public information with shared responsive gutters. */
export default function TutorsPage(): ReactElement {
  const waitlistHref = buildWhatsAppUrl(WAITLIST_MESSAGE)
  return (
    <>
      <BlueCover
        crumbs={[{ label: 'Home', href: '/' }, { label: 'Tutors' }]}
        title="Tutors"
        lede="Tutoring isn’t available yet. Join the waitlist and we’ll message you when it opens."
      />

      <section className="bg-ci-paper student-page" data-screen-label="Coming soon">
        <div className={WRAP}>
          <div className="rounded-[24px] border border-ci-border bg-ci-white p-[36px_24px] shadow-ci-card desktop:p-[48px_44px]">
            <a
              className={cx(btnBase, btnAccent)}
              href={waitlistHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              Join the waitlist
            </a>

            <div className="mt-8 border-t border-ci-border pt-6">
              <p className="max-w-[60ch] text-[16.5px] leading-[1.6] text-ci-gray-600">
                Want to tutor? Apply if you’re in 300 Level or above.
              </p>
              <Link className={cx(btnBase, btnNavy, 'mt-4')} href="/become-a-tutor">
                Apply to tutor
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
