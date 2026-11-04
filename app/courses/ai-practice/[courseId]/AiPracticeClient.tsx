'use client'
// app/courses/ai-practice/[courseId]/AiPracticeClient.tsx — Upload notes, follow progress, then practise the personal set.
import { useRef, useState } from 'react'
import { FileUp, LoaderCircle } from 'lucide-react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { UPLOAD_ACCEPT_ATTRIBUTE, approximateWords } from '@/lib/ai-practice/upload-contract'
import type { AllowanceSummary, PersonalSetView } from '@/lib/ai-practice/upload-contract'
import { NEUTRAL_TRIAL_WORDING } from '@/lib/entitlements/presentation'
import type { TrialWording } from '@/lib/entitlements/presentation'
import { NOT_ENTITLED_TITLE, createGenerationRequests, generateFromDocument, grantName, notEntitledMessage,
  runUploadJourney } from './journey'
import type { JourneyOutcome, JourneyPhase } from './journey'
import { PersonalDisclaimer, PersonalPractice } from './PersonalPractice'
import type { ReactElement } from 'react'

const PHASE_COPY: Record<JourneyPhase, { title: string; detail: string }> = {
  uploading: { title: 'Uploading your file', detail: 'Keep this page open while your file uploads.' },
  reading: { title: 'Reading your notes', detail: 'Preparing your notes for practice questions.' },
  generating: { title: 'Writing five questions', detail: 'This may take a moment. Keep this page open.' },
}

/** One honest sentence about a counted grant; nothing for token-funded access (paid or Early Access, which have
 *  session and week limits), when there is none, or when it cannot be read. */
export function allowanceLine(allowance: AllowanceSummary | null, trial: TrialWording = NEUTRAL_TRIAL_WORDING): string | null {
  if (!allowance || allowance.state === 'not-entitled') return null
  if (allowance.state === 'expired') return `Your ${grantName(allowance, trial)} has ended.`
  if (allowance.total === null) return null
  const left = Math.max(0, allowance.total - allowance.used)
  const sets = `${left} of ${allowance.total} Campus Bot ${allowance.total === 1 ? 'set' : 'sets'} left`
  if (allowance.sourceCharLimit === undefined) return `${sets} in your ${grantName(allowance, trial)}.`
  return `${sets} on your ${grantName(allowance, trial)}. Upload notes of up to about ` +
    `${approximateWords(allowance.sourceCharLimit).toLocaleString('en-GB')} words.`
}

/** Progress for the current step. */
export function JourneyProgress({ phase }: { phase: JourneyPhase }): ReactElement {
  return <div className="ai-practice-progress" role="status" aria-live="polite">
    <LoaderCircle aria-hidden="true" size={20} strokeWidth={1.75} className="animate-spin" />
    <div><p className="ai-practice-progress-title">{PHASE_COPY[phase].title}</p>
      <p className="ai-practice-progress-detail">{PHASE_COPY[phase].detail}</p></div>
  </div>
}

type Props = {
  courseId: string
  continuityToken: string
  initialAllowance: AllowanceSummary | null
  recentSets: PersonalSetView[]
  /** The student's own trial grant and whether a pass can still be started; the copy names what they actually hold. */
  canGenerate?: boolean
  uploadsUnavailableReason?: 'outside-list' | 'paused'
  trial?: TrialWording
  /** The copy switch (plans_on_sale). */
  plansOnSale?: boolean
}

export function AiPracticeClient({ courseId, continuityToken, initialAllowance, recentSets,
  trial = NEUTRAL_TRIAL_WORDING, canGenerate = true, uploadsUnavailableReason, plansOnSale = false }: Props):
  ReactElement {
  const input = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<JourneyPhase | null>(null)
  const [outcome, setOutcome] = useState<Extract<JourneyOutcome, { kind: 'problem' }> | null>(null)
  const [allowance, setAllowance] = useState(initialAllowance)
  const [sets, setSets] = useState(recentSets)
  const [active, setActive] = useState<PersonalSetView | null>(null)
  // Lives as long as the page, so "Try again" after a lost reply or a busy answer reuses the same request id.
  const [requests] = useState(() => createGenerationRequests(() => crypto.randomUUID()))

  async function settle(result: JourneyOutcome): Promise<void> {
    setPhase(null)
    if ('allowance' in result && result.allowance) setAllowance(result.allowance)
    if (result.kind === 'generated') {
      setOutcome(null)
      setSets(previous => [result.set, ...previous.filter(set => set.generationId !== result.set.generationId)])
      setActive(result.set)
      return
    }
    // The page's account gate owns the sign-in redirect and return path.
    if (result.signedOut) window.location.reload()
    setOutcome(result)
  }

  const deps = () => ({ fetch: window.fetch.bind(window), continuityToken, courseId, trial, plansOnSale, onPhase: setPhase,
    requests })

  async function upload(file: File): Promise<void> {
    setOutcome(null)
    setActive(null)
    await settle(await runUploadJourney(file, deps()))
    if (input.current) input.current.value = ''
  }

  async function retry(documentId: string): Promise<void> {
    setOutcome(null)
    await settle(await generateFromDocument(documentId, deps()))
  }

  if (active) return <PersonalPractice set={active} onClose={() => setActive(null)} />
  const busy = phase !== null
  const line = allowanceLine(allowance, trial)
  const entitled = canGenerate && allowance?.state !== 'not-entitled'

  return <div className="ai-practice-workspace">
    <PersonalDisclaimer />
    {!canGenerate && sets.length > 0 && uploadsUnavailableReason ? <p className="ai-practice-upload-help">
      {uploadsUnavailableReason === 'outside-list'
        ? 'Uploads are available for your courses this semester. Your saved sets are still here.'
        : 'Uploads are paused for now. Your saved sets are still here.'}
    </p> : null}
    {canGenerate && !entitled && <Notice title={NOT_ENTITLED_TITLE} tone="info">{notEntitledMessage(trial, plansOnSale)}</Notice>}
    {entitled && <section className="ai-practice-upload" aria-labelledby="ai-practice-upload-title" aria-busy={busy}>
      <h2 id="ai-practice-upload-title" className="ai-practice-upload-title">Upload your notes</h2>
      <p className="ai-practice-upload-help">PDF, Word (.docx) or plain text, up to 5 MB. Upload one topic or chapter
        at a time for the best questions. Files are deleted after reading; the text is kept privately for 7 days.</p>
      {line && <p className="ai-practice-allowance">{line}</p>}
      <input ref={input} id="ai-practice-file" type="file" className="sr-only" accept={UPLOAD_ACCEPT_ATTRIBUTE}
        disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file) }} />
      <label htmlFor="ai-practice-file" className={studentAction(btnNavy, studentFocusDark, busy && 'pointer-events-none opacity-60')}>
        <FileUp aria-hidden="true" size={18} strokeWidth={1.75} /> Choose a file
      </label>
      {phase && <JourneyProgress phase={phase} />}
    </section>}
    {outcome && <Notice title={outcome.title} tone={outcome.tone} action={outcome.documentId
      ? <button type="button" className={studentAction(btnGhost)} onClick={() => void retry(outcome.documentId!)}>Try again</button>
      : undefined}>{outcome.message}</Notice>}
    {sets.length > 0 && <section className="ai-practice-history" aria-labelledby="ai-practice-history-title">
      <h2 id="ai-practice-history-title" className="ai-practice-upload-title">Your recent question sets</h2>
      <ul className="ai-practice-history-list">
        {sets.map(set => <li key={set.generationId}>
          <button type="button" className={studentAction(btnGhost, 'w-full justify-between')} onClick={() => setActive(set)}>
            <span>{set.fileName ?? 'Uploaded notes'} · {set.questions.length} questions</span>
            <span className="ai-practice-history-date">{set.createdAt.slice(0, 10)}</span>
          </button>
        </li>)}
      </ul>
      <p className="ai-practice-upload-help">Question sets are kept for 30 days.</p>
    </section>}
  </div>
}
