// app/courses/[slug]/quiz/ReportQuestionDialog.tsx — Report the exact item and revision a completed attempt showed.
'use client'

import { useId, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { REPORT_NOTE_MAX_CHARACTERS, clampNote, noteLength } from '@/lib/question-reports/note-limit'
import type { ReportTarget } from './types'
import type { ReactElement } from 'react'

export const REPORT_ENDPOINT = '/api/question-reports'
type Outcome = 'reported' | 'already-reported' | 'limited'
type Phase = { kind: 'idle' | 'busy' } | { kind: 'error'; session: boolean } | { kind: 'done'; outcome: Outcome }

export const REPORT_COPY = {
  title: 'Report a question',
  label: 'What’s wrong with it?',
  help: 'For example: the marked answer is wrong, or the question is unclear.',
  errorTitle: 'Your report couldn’t be sent.',
  errorBody: 'Your note is kept. Try again in a moment.',
  sessionTitle: 'Your sign-in changed.',
  sessionBody: 'Reload this page and sign in again before reporting. Your note is kept here until you leave.',
  done: {
    reported: { title: 'Report sent', body: 'Thanks. The CampusIntell team will check this question.' },
    'already-reported': { title: 'You’ve already reported this question', body: 'You don’t need to send another report.' },
    limited: { title: 'Report not sent', body: 'You’ve sent several reports recently. Try again later.' },
  },
} as const

function formatCount(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Resolve the backend's outcome; anything unreadable is a plain failure the student can retry. */
export async function sendQuestionReport(target: ReportTarget, note: string, continuityToken: string,
  request: typeof fetch = fetch): Promise<Outcome | 'session' | 'failed'> {
  try {
    const response = await request(REPORT_ENDPOINT, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', [AUTH_CONTINUITY_HEADER]: continuityToken },
      body: JSON.stringify({ courseId: target.courseId, itemId: target.itemId, revision: target.revision,
        questionId: target.questionId, attemptId: target.attemptId, note: note.trim() || null }),
    })
    const body: unknown = await response.json().catch(() => null)
    const status = typeof body === 'object' && body !== null && 'status' in body ? body.status : null
    if (status === 'reported' || status === 'already-reported' || status === 'limited') return status
    if (status === 'signed-out' || status === 'session-changed') return 'session'
    return 'failed'
  } catch { return 'failed' }
}

type Props = {
  target: ReportTarget
  questionNumber: number
  continuityToken: string
  onClose: () => void
  onReported: (questionId: string) => void
  // The shared Dialog's close lifecycle; the owner of the review item decides where focus lands.
  onRestoreFocus: (event: Event) => void
}

/** One report per dialog mount; the parent keys the dialog by question so a new target starts clean. */
export function ReportQuestionDialog({ target, questionNumber, continuityToken, onClose, onReported, onRestoreFocus }: Props): ReactElement {
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const id = useId()
  const busy = phase.kind === 'busy'
  const count = noteLength(note)

  const send = async () => {
    if (busy) return
    setPhase({ kind: 'busy' })
    const outcome = await sendQuestionReport(target, note, continuityToken)
    if (outcome === 'failed' || outcome === 'session') { setPhase({ kind: 'error', session: outcome === 'session' }); return }
    if (outcome !== 'limited') onReported(target.questionId)
    setPhase({ kind: 'done', outcome })
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="student-practice-dialog z-[70] motion-reduce:!animate-none" onCloseAutoFocus={onRestoreFocus}>
      <DialogHeader>
        <DialogTitle className="text-left text-[20px] font-bold text-student-primary">{REPORT_COPY.title}</DialogTitle>
        <DialogDescription className="text-left text-[15px] leading-[1.5] text-student-text-secondary">
          Question {questionNumber}, exactly as it appeared in this attempt.
        </DialogDescription>
      </DialogHeader>
      {phase.kind === 'done' ? <>
        <Notice tone="info" title={REPORT_COPY.done[phase.outcome].title}>{REPORT_COPY.done[phase.outcome].body}</Notice>
        <div className="student-practice-foot">
          <button type="button" className={studentAction(btnNavy, studentFocusDark)} onClick={onClose}>Done</button>
        </div>
      </> : <form onSubmit={event => { event.preventDefault(); void send() }}>
        <label htmlFor={`${id}-note`} className="block text-[14px] font-semibold text-student-text-primary">
          {REPORT_COPY.label} <span className="font-normal text-student-text-muted">(optional)</span>
        </label>
        <p id={`${id}-help`} className="student-practice-help !mt-1">{REPORT_COPY.help}</p>
        {/* No native maxLength: it counts UTF-16 units, while the shared contract and the counter count code points. */}
        <Textarea id={`${id}-note`} aria-describedby={`${id}-help`} value={note} disabled={busy}
          onChange={event => setNote(clampNote(event.target.value))}
          className="student-focus-control mt-3 min-h-[120px] rounded-[11px] border-student-control-border bg-student-surface text-[15px] text-student-text-primary" />
        <p className="student-practice-count-chars" aria-live="off">{formatCount(count)} / {formatCount(REPORT_NOTE_MAX_CHARACTERS)}</p>
        {phase.kind === 'error' ? <div className="mt-3">
          <Notice title={phase.session ? REPORT_COPY.sessionTitle : REPORT_COPY.errorTitle}>
            {phase.session ? REPORT_COPY.sessionBody : REPORT_COPY.errorBody}
          </Notice>
        </div> : null}
        <div className="student-practice-foot">
          <button type="button" className={studentAction(btnGhost)} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className={studentAction(btnNavy, studentFocusDark)} disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Sending report' : phase.kind === 'error' ? 'Try again' : 'Submit report'}
          </button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>
}
