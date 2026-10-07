// Become a tutor (/become-a-tutor) — Variant B server shell around the client
// form. VISUAL RESKIN ONLY: the blue cover is static (Server Component); only
// the form (state, counter, WhatsApp handoff) is a client island.
import { BlueCover } from '@/components/chrome/BlueCover'
import { TutorForm } from './TutorForm'

import type { ReactElement } from 'react'

const WRAP = 'app-container'

/** Render the existing public information with shared responsive gutters. */
export default function BecomeTutorPage(): ReactElement {
  return (
    <>
      <BlueCover
        crumbs={[{ label: 'Tutors', href: '/tutors' }, { label: 'Apply' }]}
        kicker="Recruitment · 300L and above"
        title="Apply to tutor"
        lede="Know a course cold? Help juniors decode it, and get paid for the sessions you run. Tell us what you can teach."
      />

      <section className="bg-ci-paper student-page" data-screen-label="Application form">
        <div className={WRAP}>
          <TutorForm />
        </div>
      </section>
    </>
  )
}
