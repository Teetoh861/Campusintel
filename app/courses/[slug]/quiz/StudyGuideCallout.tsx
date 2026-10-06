// app/courses/[slug]/quiz/StudyGuideCallout.tsx
// Secondary BUA202 study-guide request below the assessment commitment.

import { buildMaterialRequestEmailUrl } from '@/lib/material-email'
import type { ReactElement } from 'react'

const STUDY_GUIDE_COURSE = 'BUA202'

/** Offer the BUA202 study guide below the assessment commitment. */
export function StudyGuideCallout(): ReactElement {
  const href = buildMaterialRequestEmailUrl(
    STUDY_GUIDE_COURSE,
    'the full theory study guide',
  )
  return (
    <div className="text-[13px] leading-[1.5] text-ci-gray-600">
      Preparing for BUA202 theory?{' '}
      <a href={href} className="inline-flex min-h-11 items-center font-semibold text-ci-navy underline underline-offset-2">
        Request the study guide privately
      </a>
    </div>
  )
}
