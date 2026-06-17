// Contact (/contact) — Variant B. VISUAL RESKIN ONLY: three method rows with
// WhatsApp highlighted (amber-tinted), then phone (tel:) and email (mailto:) as
// clean white rows. The number comes from the shared env helper; the email from
// lib/contact.ts so it's correct everywhere by construction.
import { BlueCover } from '@/components/chrome/BlueCover'
import { buildWhatsAppUrl, WHATSAPP_NUMBER } from '@/lib/whatsapp'
import { CONTACT_EMAIL } from '@/lib/contact'

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

// Pretty-print a digits-only number for display. Conservatively NG-specific:
// +234 ### ### #### when the input is a 13-digit number starting 234,
// otherwise fall back to "+<digits>" so a non-NG configuration still renders
// something sensible.
function formatPhone(digits: string): string {
  if (!digits) return ''
  if (digits.length === 13 && digits.startsWith('234')) {
    return `+234 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9, 13)}`
  }
  return `+${digits}`
}

export default function ContactPage() {
  const phoneDisplay = formatPhone(WHATSAPP_NUMBER)
  const telHref = `tel:+${WHATSAPP_NUMBER}`
  const waHref = buildWhatsAppUrl()
  return (
    <>
      <BlueCover
        crumbs={[{ label: 'Home', href: '/' }, { label: 'Contact' }]}
        kicker="Direct line · We read everything"
        title="Get in touch"
        lede="Questions, a course you want decoded, or a correction on the intel: reach us on whichever line suits you. WhatsApp is fastest."
      />

      <section className="bg-ci-paper pb-20 pt-10 min-[900px]:pt-12" data-screen-label="Contact methods">
        <div className={WRAP}>
          <div className="mx-auto flex max-w-[680px] flex-col gap-4">
            {/* WhatsApp: the highlighted/primary method (amber-tinted) */}
            <a
              className="group flex items-center justify-between gap-4 rounded-[14px] border border-ci-accent-100 bg-ci-accent-50 p-[18px_22px] transition-[transform,box-shadow] duration-150 hover:-translate-y-[2px] hover:shadow-ci-card"
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-ci-accent-600">
                  <span className="h-[7px] w-[7px] rounded-full bg-ci-accent" />
                  WhatsApp · fastest
                </div>
                <div className="mt-1 text-[18px] font-bold text-ci-navy-900 [font-variant-numeric:tabular-nums]">{phoneDisplay}</div>
              </div>
              <span className="text-[18px] text-ci-accent-600 transition-transform duration-150 group-hover:translate-x-[3px]">&rarr;</span>
            </a>

            <a
              className="group flex items-center justify-between gap-4 rounded-[14px] border border-ci-border bg-ci-white p-[18px_22px] transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-[2px] hover:border-ci-border-2 hover:shadow-ci-card"
              href={telHref}
            >
              <div className="min-w-0">
                <div className="text-[12px] font-bold uppercase tracking-[0.1em] text-ci-gray-500">Call</div>
                <div className="mt-1 text-[18px] font-bold text-ci-navy-900 [font-variant-numeric:tabular-nums]">{phoneDisplay}</div>
              </div>
              <span className="text-[18px] text-ci-navy transition-transform duration-150 group-hover:translate-x-[3px]">&rarr;</span>
            </a>

            <a
              className="group flex items-center justify-between gap-4 rounded-[14px] border border-ci-border bg-ci-white p-[18px_22px] transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-[2px] hover:border-ci-border-2 hover:shadow-ci-card"
              href={`mailto:${CONTACT_EMAIL}`}
            >
              <div className="min-w-0">
                <div className="text-[12px] font-bold uppercase tracking-[0.1em] text-ci-gray-500">Email</div>
                <div className="mt-1 break-words text-[18px] font-bold text-ci-navy-900">{CONTACT_EMAIL}</div>
              </div>
              <span className="text-[18px] text-ci-navy transition-transform duration-150 group-hover:translate-x-[3px]">&rarr;</span>
            </a>
          </div>

          <p className="mx-auto mt-6 max-w-[680px] text-[14px] text-ci-gray-600">
            Typical response · within a day on WhatsApp · Mon to Sat, 9:00 to 18:00 WAT
          </p>
        </div>
      </section>
    </>
  )
}
