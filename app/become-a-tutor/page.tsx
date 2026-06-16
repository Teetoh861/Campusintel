// Become a tutor (/become-a-tutor) — server shell around the client form.
// The cover is static so it can be a Server Component; only the form itself
// (state, counter, WhatsApp handoff) is a client island.
import Link from 'next/link'
import '../../styles/pages.css'
import { HeroMotif } from '@/components/chrome/HeroMotif'
import { TutorForm } from './TutorForm'

export default function BecomeTutorPage() {
  return (
    <>
      <header className="course-cover" data-screen-label="Cover">
        <HeroMotif />
        <div className="wrap">
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/tutors">Tutors</Link>
            <span className="sep">/</span>
            <span className="cur">Apply</span>
          </nav>
          <div className="pg-kicker">
            Recruitment <span className="sep">·</span> 300L and above
          </div>
          <h1 className="pg-title">Apply to tutor</h1>
          <p className="pg-lede">
            Know a course cold? Help juniors decode it, and get paid for the
            sessions you run. Tell us what you can teach.
          </p>
        </div>
      </header>

      <section className="pg-body" data-screen-label="Application form">
        <div className="wrap">
          <TutorForm />
        </div>
      </section>
    </>
  )
}
