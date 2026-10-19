// Tutors (/tutors) — Variant B peer-tutoring "coming soon" page. VISUAL
// RESKIN ONLY: blue cover + a calm white card with a sophisticated outlined
// status, the who/format/where/when readout, and the waitlist CTAs. The
// WhatsApp URL is built once at request-time from the env helper.
import Link from 'next/link'
import { BlueCover } from '@/components/chrome/BlueCover'
import { btnAccent, btnBase, btnNavy, cx } from '@/components/chrome/ui'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

import type { ReactElement } from 'react'

const WRAP = 'app-container'
const WAITLIST_MESSAGE = "I'd like to join the CampusIntel tutoring waitlist."

/** Render the existing public information with shared responsive gutters. */
export default function TutorsPage(): ReactElement {
  const waitlistHref = buildWhatsAppUrl(WAITLIST_MESSAGE)
  return (
    <>
      <BlueCover
        crumbs={[{ label: 'Home', href: '/' }, { label: 'Tutors' }]}
        kicker="Tutoring waitlist"
        title="Peer tutoring"
        lede="Interested in one-to-one course support? Join the waitlist to hear when peer tutoring is available."
      />

      <section className="bg-ci-paper student-page" data-screen-label="Coming soon">
        <div className={WRAP}>
          <div className="rounded-[24px] border border-ci-border bg-ci-white p-[36px_24px] shadow-ci-card desktop:p-[48px_44px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-ci-blue-200 bg-ci-blue-50 px-[15px] py-[7px] text-[12.5px] font-bold uppercase tracking-[0.12em] text-ci-navy">
              <span className="h-[6px] w-[6px] rounded-full bg-ci-navy" />
              Not currently available
            </span>
            <h2 className="mt-5 max-w-[22ch] text-[clamp(24px,3.6vw,32px)] font-extrabold leading-[1.1] tracking-[-0.03em] text-ci-navy-900">
              Join the peer tutoring waitlist.
            </h2>
            <p className="mt-4 max-w-[60ch] text-[16.5px] leading-[1.6] text-ci-gray-600">
              Tutoring sessions are not available to book. You can join the waitlist on WhatsApp
              and tell us which courses or topics you would like help with.
            </p>

            <div className="mt-8 flex flex-col gap-0 border-t border-ci-border">
              <CmRow k="For students" v="Tell us which courses or topics you need help with." />
              <CmRow k="For tutors" v="Apply if you are in 300 Level or above and have strong course results." />
              <CmRow k="Contact" v="Join the waitlist or send a tutor application through WhatsApp." />
              <CmRow k="Availability" v="Sessions are not available to book. Join the waitlist for updates." />
            </div>

            <div className="mt-8 flex flex-wrap gap-[13px]">
              <a
                className={cx(btnBase, btnAccent)}
                href={waitlistHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                Join the waitlist
              </a>
              <Link className={cx(btnBase, btnNavy)} href="/become-a-tutor">
                Apply to tutor
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function CmRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-ci-border py-[14px] tablet:grid-cols-[130px_1fr] tablet:gap-4">
      <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-ci-gray-500">{k}</span>
      <span className="text-[15.5px] leading-[1.5] text-ci-gray-700">{v}</span>
    </div>
  )
}
