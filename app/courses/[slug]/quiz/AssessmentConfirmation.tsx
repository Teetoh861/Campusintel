// app/courses/[slug]/quiz/AssessmentConfirmation.tsx — Confirm submitting with contained focus and truthful counts.
// Leaving asks "End exam?" instead (components/student/EndExamDialog.tsx).
'use client'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { PRACTICE_COPY } from './practice-presentation'
import type { ReactElement } from 'react'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onRestoreFocus: (event: Event) => void
  kind: 'submit'
  answered: number
  unanswered: number
  flagged: number
}

/** Confirm a final decision; the safe action always receives initial focus. */
export function AssessmentConfirmation(props: Props): ReactElement {
  return <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
    <AlertDialogContent className="student-practice-dialog z-[70] motion-reduce:!animate-none" onCloseAutoFocus={props.onRestoreFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle className="text-left text-[20px] font-bold text-student-primary">{PRACTICE_COPY.submitTitle}</AlertDialogTitle>
        <AlertDialogDescription className="text-left text-[15px] leading-[1.5] text-student-text-secondary">
          {PRACTICE_COPY.submitBody}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <dl className="student-practice-summary">
        <SummaryCount label="Answered" value={props.answered} />
        <SummaryCount label="Unanswered" value={props.unanswered} />
        <SummaryCount label="Flagged" value={props.flagged} />
      </dl>
      <AlertDialogFooter className="student-practice-foot sm:space-x-0">
        <AlertDialogCancel className={studentAction(btnGhost, 'mt-0')}>Keep going</AlertDialogCancel>
        <AlertDialogAction className={studentAction(btnNavy, studentFocusDark)} onClick={props.onConfirm}>{PRACTICE_COPY.submitExam}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}
