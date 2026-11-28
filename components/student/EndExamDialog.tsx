// components/student/EndExamDialog.tsx — Leaving a timed exam ends it: Exit and the back button both ask here first.
// The safe choice, Keep going, takes the focus and returns to the same question with the timer still running. End and
// see results stays on screen, saying Submitting…, until the hand-in is done, so a second tap lands on it and nothing
// else: the result replaces the exam, or a hand-in that did not go through closes it and the exam says so.
'use client'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import type { ReactElement } from 'react'

/** The owner's words (J1). */
export const END_EXAM_COPY = {
  title: 'End exam?',
  body: 'Your answers will be submitted and marked. You can’t change them after this.',
  end: 'End and see results',
  keepGoing: 'Keep going',
  submitting: 'Submitting…',
} as const

/** "End exam?" for both timed exams. onEnd hands the exam in; closing any other way is Keep going. */
export function EndExamDialog({ open, submitting = false, onKeepGoing, onEnd, onRestoreFocus }: {
  open: boolean
  /** The hand-in is on its way: both buttons wait. */
  submitting?: boolean
  onKeepGoing: () => void
  onEnd: () => void
  onRestoreFocus?: (event: Event) => void
}): ReactElement {
  return <AlertDialog open={open} onOpenChange={next => { if (!next && !submitting) onKeepGoing() }}>
    <AlertDialogContent className="student-practice-dialog z-[70] motion-reduce:!animate-none" onCloseAutoFocus={onRestoreFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle className="text-left text-[20px] font-bold text-student-primary">{END_EXAM_COPY.title}</AlertDialogTitle>
        <AlertDialogDescription className="text-left text-[15px] leading-[1.5] text-student-text-secondary">
          {END_EXAM_COPY.body}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="student-practice-foot sm:space-x-0">
        {/* Kept open on purpose: the exam closes it once the hand-in is done. */}
        <AlertDialogAction className={studentAction(btnGhost)} disabled={submitting}
          onClick={event => { event.preventDefault(); if (!submitting) onEnd() }}>
          {submitting ? END_EXAM_COPY.submitting : END_EXAM_COPY.end}
        </AlertDialogAction>
        {/* The dialog's Cancel brings an outline button's dark hover text; Keep going stays white on navy under a pointer. */}
        <AlertDialogCancel className={studentAction(btnNavy, studentFocusDark, 'mt-0 hover:text-student-primary-text')}
          disabled={submitting}>
          {END_EXAM_COPY.keepGoing}
        </AlertDialogCancel>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
