// app/courses/[slug]/quiz/AssessmentConfirmation.tsx — Confirm submitting or leaving with contained focus and truthful counts.
'use client'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { PRACTICE_COPY, plural } from './practice-presentation'
import type { ReactElement } from 'react'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onRestoreFocus: (event: Event) => void
} & ({ kind: 'leave' } | { kind: 'submit'; answered: number; unanswered: number; flagged: number })

/** Confirm a final decision; the safe action always receives initial focus. */
export function AssessmentConfirmation(props: Props): ReactElement {
  const submitting = props.kind === 'submit'
  return <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
    <AlertDialogContent className="student-practice-dialog z-[70] motion-reduce:!animate-none" onCloseAutoFocus={props.onRestoreFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle className="text-left text-[20px] font-bold text-student-primary">
          {submitting ? PRACTICE_COPY.submitTitle : PRACTICE_COPY.leaveTitle}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-left text-[15px] leading-[1.5] text-student-text-secondary">
          {submitting ? PRACTICE_COPY.submitBody : PRACTICE_COPY.leaveBody}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {props.kind === 'submit' ? <>
        <dl className="student-practice-summary">
          <SummaryCount label="Answered" value={props.answered} />
          <SummaryCount label="Unanswered" value={props.unanswered} />
          <SummaryCount label="Flagged" value={props.flagged} />
        </dl>
        {props.unanswered > 0 ? <p className="m-0 text-[14px] leading-[1.5] text-student-text-secondary">
          {plural(props.unanswered, 'question is', 'questions are')} unanswered. You can still submit; unanswered questions count as missed.
        </p> : null}
      </> : null}
      <AlertDialogFooter className="student-practice-foot sm:space-x-0">
        {submitting ? <>
          <AlertDialogCancel className={studentAction(btnGhost, 'mt-0')}>Keep working</AlertDialogCancel>
          <AlertDialogAction className={studentAction(btnNavy, studentFocusDark)} onClick={props.onConfirm}>Submit practice</AlertDialogAction>
        </> : <>
          <AlertDialogAction className={studentAction(btnGhost, 'student-practice-destructive')} onClick={props.onConfirm}>Leave practice</AlertDialogAction>
          <AlertDialogCancel className={studentAction(btnNavy, studentFocusDark, 'mt-0')}>Stay and continue</AlertDialogCancel>
        </>}
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}
