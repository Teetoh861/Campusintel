// Contact (/contact) — three dossier entries: WhatsApp (the lone teal
// signal), phone (tel:), email (mailto:). The number is pulled from the
// shared env helper, so it's correct everywhere by construction.
import Link from 'next/link'
import '../../styles/pages.css'
import { HeroMotif } from '@/components/chrome/HeroMotif'
import { buildWhatsAppUrl, WHATSAPP_NUMBER } from '@/lib/whatsapp'

const EMAIL = 'hello@campusintel.ng'

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
      <header className="course-cover" data-screen-label="Cover">
        <HeroMotif />
        <div className="wrap">
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span className="sep">/</span>
            <span className="cur">Contact</span>
          </nav>
          <div className="pg-kicker">
            Direct line <span className="sep">·</span> We read everything
          </div>
          <h1 className="pg-title">Get in touch</h1>
          <p className="pg-lede">
            Questions, a course you want decoded, or a correction on the intel:
            reach us on whichever line suits you. WhatsApp is fastest.
          </p>
        </div>
      </header>

      <section className="pg-body" data-screen-label="Contact methods">
        <div className="wrap">
          <div className="contact-list">
            <a
              className="contact-row primary"
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="cr-main">
                <div className="cr-k">
                  <span className="sig" />WhatsApp · fastest
                </div>
                <div className="cr-v">{phoneDisplay}</div>
              </div>
              <span className="cr-go">&rarr;</span>
            </a>

            <a className="contact-row" href={telHref}>
              <div className="cr-main">
                <div className="cr-k">Call</div>
                <div className="cr-v">{phoneDisplay}</div>
              </div>
              <span className="cr-go">&rarr;</span>
            </a>

            <a className="contact-row" href={`mailto:${EMAIL}`}>
              <div className="cr-main">
                <div className="cr-k">Email</div>
                <div className="cr-v">{EMAIL}</div>
              </div>
              <span className="cr-go">&rarr;</span>
            </a>
          </div>

          <p className="contact-meta">
            Typical response · within a day on WhatsApp · Mon–Sat, 9:00–18:00
            WAT
          </p>
        </div>
      </section>
    </>
  )
}
