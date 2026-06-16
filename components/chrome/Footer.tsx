// Footer — global page footer. Ports _design/bundle/footer.bundle.html.
// Server Component (no interactivity); the copyright year is computed at
// render time so it stays current without manual edits.
import Link from 'next/link'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import { CONTACT_EMAIL } from '@/lib/contact'

const WHATSAPP_URL = buildWhatsAppUrl('Hello, I need help with CampusIntel')

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="site-footer" data-screen-label="Footer">
      <div className="wrap">
        <div className="ft-top">
          <div className="ft-brand">
            <Link href="/" className="brand" aria-label="CampusIntel home">
              <ApertureMark />
              <Wordmark />
            </Link>
            <p className="ft-tag">
              Academic intelligence for the University of Lagos. The inside track on
              every paper.
            </p>
          </div>
          <div className="ft-col">
            <div className="ft-h">Navigate</div>
            <ul>
              <li><Link href="/courses">Courses</Link></li>
              <li><Link href="/bookmarks">Bookmarks</Link></li>
              <li><Link href="/tutors">Tutors</Link></li>
              <li><Link href="/contact">Contact</Link></li>
            </ul>
          </div>
          <div className="ft-col">
            <div className="ft-h">Contact</div>
            <ul>
              <li>
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                  WhatsApp · message us
                </a>
              </li>
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </li>
              <li><Link href="/become-a-tutor">Apply to tutor</Link></li>
            </ul>
          </div>
        </div>
        <div className="ft-bottom">
          <span className="fdot" />
          <span className="fc">© {year} CampusIntel</span>
          <span className="fr">University of Lagos · more coming</span>
        </div>
      </div>
    </footer>
  )
}

function ApertureMark() {
  return (
    <svg className="ap" viewBox="0 0 100 100" width={26} height={26} aria-hidden="true">
      <path
        d="M 76.2 68.35 A 32 32 0 1 1 76.2 31.65"
        fill="none"
        stroke="currentColor"
        strokeWidth="11"
        strokeLinecap="round"
      />
      <circle cx="84.5" cy="50" r="7.5" fill="#0E9180" />
    </svg>
  )
}

function Wordmark() {
  return (
    <span className="wordmark">
      <span className="campus">Campus</span>
      <span className="i-wrap">
        {'ı'}
        <span className="tdot" />
      </span>
      <span className="campus">ntel</span>
    </span>
  )
}
