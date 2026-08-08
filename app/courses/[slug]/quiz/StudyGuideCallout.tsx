// app/courses/[slug]/quiz/StudyGuideCallout.tsx
// Practice-only disclaimer + WhatsApp study-guide request, shown on the quiz
// INTRO screen directly under the "Start assessment" / "Back to course" row, as
// a full-width secondary outlined control on the blue field. Reuses the shared
// buildWhatsAppUrl helper so the number stays centralized in
// NEXT_PUBLIC_WHATSAPP_NUMBER.

import { btnBase, btnGhostOnBlue, cx } from '@/components/chrome/ui'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

const STUDY_GUIDE_MESSAGE =
  "Hi CampusIntel, I'd like to request the full BUA202 theory study guide."

export function StudyGuideCallout() {
  const href = buildWhatsAppUrl(STUDY_GUIDE_MESSAGE)
  return (
    <div className="mt-[13px] w-full">
      <p className="max-w-[60ch] text-[14px] leading-[1.55] text-ci-blue-200">
        These are practice questions only. Preparing for the theory exam? Request
        the full BUA202 study guide here.
      </p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cx(btnBase, btnGhostOnBlue, 'mt-3 flex w-full')}
      >
        Request study guide
      </a>
    </div>
  )
}
