// Become a tutor (/become-a-tutor) — Variant B server shell around the client
// form. VISUAL RESKIN ONLY: the blue cover is static (Server Component); only
// the form (state, counter, WhatsApp handoff) is a client island.
import { BlueCover } from '@/components/chrome/BlueCover'
import { TutorForm } from './TutorForm'

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

export default function BecomeTutorPage() {
  return (
    <>
      <BlueCover
        crumbs={[{ label: 'Tutors', href: '/tutors' }, { label: 'Apply' }]}
        kicker="Recruitment · 300L and above"
        title="Apply to tutor"
        lede="Know a course cold? Help juniors decode it, and get paid for the sessions you run. Tell us what you can teach."
      />

      <section className="bg-ci-paper pb-20 pt-10 min-[900px]:pt-12" data-screen-label="Application form">
        <div className={WRAP}>
          <TutorForm />
        </div>
      </section>
    </>
  )
}
