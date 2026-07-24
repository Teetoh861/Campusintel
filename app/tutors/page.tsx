// Tutors (/tutors) — Variant B peer-tutoring "coming soon" page. VISUAL
// RESKIN ONLY: blue cover + a calm white card with a sophisticated outlined
// status, the who/format/where/when readout, and the waitlist CTAs. The
// WhatsApp URL is built once at request-time from the env helper.
import Link from 'next/link'
import { BlueCover } from '@/components/chrome/BlueCover'
import { btnAccent, btnBase, btnNavy, cx } from '@/components/chrome/ui'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'
const WAITLIST_MESSAGE = "I'd like to join the CampusIntel tutoring waitlist."

export default function TutorsPage() {
  const waitlistHref = buildWhatsAppUrl(WAITLIST_MESSAGE)
  return (
    <>
      <BlueCover
        crumbs={[{ label: 'Home', href: '/' }, { label: 'Tutors' }]}
        kicker="Status · Incoming"
        title="Peer tutoring"
        lede="The human layer on top of the intel: one-on-one help from students who have already aced the paper."
      />

      <section className="bg-ci-paper pb-20 pt-10 min-[900px]:pt-12" data-screen-label="Coming soon">
        <div className={WRAP}>
          <div className="rounded-[24px] border border-ci-border bg-ci-white p-[36px_24px] shadow-ci-card min-[900px]:p-[48px_44px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-ci-blue-200 bg-ci-blue-50 px-[15px] py-[7px] text-[12.5px] font-bold uppercase tracking-[0.12em] text-ci-navy">
              <span className="h-[6px] w-[6px] rounded-full bg-ci-navy" />
              Coming soon
            </span>
            <h2 className="mt-5 max-w-[22ch] text-[clamp(24px,3.6vw,32px)] font-extrabold leading-[1.1] tracking-[-0.03em] text-ci-navy-900">
              We are lining up tutors who decoded these courses first.
            </h2>
            <p className="mt-4 max-w-[60ch] text-[16.5px] leading-[1.6] text-ci-gray-600">
              Self-serve intelligence already covers most of what you need. Peer tutoring adds a person for the
              parts that do not click: pair with a senior who has sat the exact paper and knows where the marks
              hide.
            </p>

            <div className="mt-8 flex flex-col gap-0 border-t border-ci-border">
              <CmRow k="Who" v="300-level and above students who scored well in the course." />
              <CmRow k="Format" v="Short, focused sessions around the exam-critical topics." />
              <CmRow k="Where" v="Booked and run through WhatsApp, no new app to learn." />
              <CmRow k="When" v="Rolling out next semester. Join the waitlist to be first." />
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
    <div className="grid grid-cols-1 gap-1 border-b border-ci-border py-[14px] min-[680px]:grid-cols-[130px_1fr] min-[680px]:gap-4">
      <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-ci-gray-500">{k}</span>
      <span className="text-[15.5px] leading-[1.5] text-ci-gray-700">{v}</span>
    </div>
  )
}
