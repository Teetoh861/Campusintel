// app/courses/[slug]/quiz/StudyGuideCallout.tsx
// Practice-only disclaimer + private email study-guide request, shown on the quiz
// INTRO screen directly under the "Start assessment" / "Back to course" row, as
// a full-width secondary outlined control on the blue field. Reuses the shared
// material email helper so the request stays course-aware.

import { btnBase, btnGhostOnBlue, cx } from '@/components/chrome/ui'
import { buildMaterialRequestEmailUrl } from '@/lib/material-email'

const STUDY_GUIDE_COURSE = 'BUA202'

export function StudyGuideCallout() {
  const href = buildMaterialRequestEmailUrl(
    STUDY_GUIDE_COURSE,
    'the full theory study guide',
  )
  return (
    <div className="mt-[13px] w-full">
      <p className="max-w-[60ch] text-[14px] leading-[1.55] text-ci-blue-200">
        These are practice questions only. Preparing for the theory exam? Request
        the full BUA202 study guide here.
      </p>
      <a
        href={href}
        className={cx(btnBase, btnGhostOnBlue, 'mt-3 flex w-full')}
      >
        Request study guide privately
      </a>
    </div>
  )
}
