// Tutors (/tutors) — the peer-tutoring "coming soon" page. Server-rendered
// dossier treatment: motif + crumb + kicker + title + lede, then a single
// .coming block with the cm-list dossier readout and the waitlist CTAs.
// The WhatsApp URL is built once at request-time from the env helper.
import Link from 'next/link'
import '../../styles/pages.css'
import { HeroMotif } from '@/components/chrome/HeroMotif'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

const WAITLIST_MESSAGE =
  "I'd like to join the CampusIntel tutoring waitlist."

export default function TutorsPage() {
  const waitlistHref = buildWhatsAppUrl(WAITLIST_MESSAGE)
  return (
    <>
      <header className="course-cover" data-screen-label="Cover">
        <HeroMotif />
        <div className="wrap">
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span className="sep">/</span>
            <span className="cur">Tutors</span>
          </nav>
          <div className="pg-kicker">
            Status <span className="sep">·</span> Incoming
          </div>
          <h1 className="pg-title">Peer tutoring</h1>
          <p className="pg-lede">
            The human layer on top of the intel: one-on-one help from students
            who have already aced the paper.
          </p>
        </div>
      </header>

      <section className="pg-body" data-screen-label="Coming soon">
        <div className="wrap">
          <div className="coming ticks">
            <span className="cm-status">
              <span className="sig" />Coming soon
            </span>
            <h2>
              We&apos;re lining up tutors who decoded these courses first.
            </h2>
            <p>
              Self-serve intelligence already covers most of what you need.
              Peer tutoring adds a person for the parts that don&apos;t click:
              pair with a senior who has sat the exact paper and knows where
              the marks hide.
            </p>

            <div className="cm-list">
              <CmRow
                k="Who"
                v="300-level and above students who scored well in the course."
              />
              <CmRow
                k="Format"
                v="Short, focused sessions around the exam-critical topics."
              />
              <CmRow
                k="Where"
                v="Booked and run through WhatsApp, no new app to learn."
              />
              <CmRow
                k="When"
                v="Rolling out next semester. Join the waitlist to be first."
              />
            </div>

            <div className="cm-cta">
              <a
                className="btn btn-primary"
                href={waitlistHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                Join the waitlist <span className="arrow">&rarr;</span>
              </a>
              <Link className="btn btn-secondary" href="/become-a-tutor">
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
    <div className="cm-li">
      <span className="cl-k">{k}</span>
      <span className="cl-v">{v}</span>
    </div>
  )
}
