'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { z } from 'zod'
import { Feedback } from '@/components/chrome/Feedback'
import { btnBase, btnGhost, btnNavy, btnSm, cx, focusRingNavy } from '@/components/chrome/ui'
import { SelectionSummary } from '@/components/profile/SelectionSummary'
import { AUTH_CONTINUITY_HEADER, AUTH_PATHS, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import type { StudentProfileState } from '@/lib/profile/student-profile'

type ProfileView = Extract<StudentProfileState, { status: 'incomplete' | 'complete' }>
type Draft = { departmentId: string; academicLevelId: string; academicPeriodId: string }
type Choice = { id: string; label: string }
type Field = keyof Draft
type Notice = { message: string; reload?: boolean; field?: Field }

const FIELD_ERRORS: Record<Field, { id: string; message: string }> = {
  departmentId: { id: 'department-error', message: 'Choose a department.' },
  academicLevelId: { id: 'academic-level-error', message: 'Choose a level.' },
  academicPeriodId: { id: 'academic-period-error', message: 'Choose a semester.' },
}

const PROFILE_API = '/api/profile-selection'
const savedResponseSchema = z.object({
  status: z.literal('complete'),
  selection: z.object({
    department: z.object({ id: z.string().uuid(), label: z.string().min(1), isActive: z.literal(true) }),
    academicLevel: z.object({ id: z.string().uuid(), label: z.string().min(1), isActive: z.literal(true) }),
    academicPeriod: z.object({ id: z.string().uuid(), label: z.string().min(1), isActive: z.literal(true) }),
  }),
})

const selectClass = cx('h-12 w-full rounded-ci-btn border border-ci-gray-600 bg-ci-white px-3 py-2 text-base text-ci-ink',
  'disabled:cursor-not-allowed disabled:opacity-60', focusRingNavy)

function selectedId(choice: { id: string }, options: Choice[]): string {
  return options.some(option => option.id === choice.id) ? choice.id : ''
}

function initialDraft(initial: ProfileView): Draft {
  if (initial.status === 'incomplete') return { departmentId: '', academicLevelId: '', academicPeriodId: '' }
  return {
    departmentId: selectedId(initial.selection.department, initial.options.departments),
    academicLevelId: selectedId(initial.selection.academicLevel, initial.options.academicLevels),
    academicPeriodId: selectedId(initial.selection.academicPeriod, initial.options.academicPeriods),
  }
}

function isSelectable(options: Choice[], id: string): boolean {
  return id !== '' && options.some(option => option.id === id)
}

/** Keep only a draft in browser memory; successful navigation requires a confirmed server save. */
export function ProfileSelectionForm({ initial, continuityToken }: { initial: ProfileView; continuityToken: string }) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(initial))
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState(false)
  const [ready, setReady] = useState(false)
  const lock = useRef(false)
  // A later RSC payload must not re-label this mounted draft as another account's.
  const pageToken = useRef(continuityToken).current
  const departmentRef = useRef<HTMLSelectElement>(null)
  const academicLevelRef = useRef<HTMLSelectElement>(null)
  const academicPeriodRef = useRef<HTMLSelectElement>(null)
  const { departments, academicLevels, academicPeriods } = initial.options
  const choicesAvailable = departments.length > 0 && academicLevels.length > 0 && academicPeriods.length > 0

  useEffect(() => { setReady(true) }, [])
  useEffect(() => {
    if (notice?.field === 'departmentId') departmentRef.current?.focus()
    else if (notice?.field === 'academicLevelId') academicLevelRef.current?.focus()
    else if (notice?.field === 'academicPeriodId') academicPeriodRef.current?.focus()
  }, [notice?.field])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || lock.current) return
    const missingField: Field | null = !isSelectable(departments, draft.departmentId) ? 'departmentId'
      : !isSelectable(academicLevels, draft.academicLevelId) ? 'academicLevelId'
        : !isSelectable(academicPeriods, draft.academicPeriodId) ? 'academicPeriodId' : null
    if (missingField) {
      setNotice({ message: FIELD_ERRORS[missingField].message, field: missingField })
      if (notice?.field === missingField) {
        if (missingField === 'departmentId') departmentRef.current?.focus()
        else if (missingField === 'academicLevelId') academicLevelRef.current?.focus()
        else academicPeriodRef.current?.focus()
      }
      return
    }
    lock.current = true
    setPending(true)
    setNotice(null)
    let navigating = false
    try {
      const response = await fetch(PROFILE_API, {
        method: 'PUT', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: pageToken }, body: JSON.stringify(draft),
      })
      const body: unknown = await response.json()
      if (response.status === 401 && body && typeof body === 'object' && 'status' in body && body.status === 'signed-out') {
        navigating = true
        window.location.replace(AUTH_PATHS.login + '?next=' + encodeURIComponent(PROFILE_SELECTION_PATH))
        return
      }
      if (response.status === 409 && body && typeof body === 'object' && 'status' in body && body.status === 'session-changed') {
        navigating = true
        window.location.reload()
        return
      }
      if (response.ok) {
        const parsed = savedResponseSchema.safeParse(body)
        if (parsed.success && parsed.data.selection.department.id === draft.departmentId &&
            parsed.data.selection.academicLevel.id === draft.academicLevelId &&
            parsed.data.selection.academicPeriod.id === draft.academicPeriodId) {
          navigating = true
          window.location.replace(STUDENT_HOME_PATH)
          return
        }
        setNotice({ message: 'Save could not be confirmed. Reload the page.', reload: true })
      } else if (body && typeof body === 'object' && 'status' in body && body.status === 'invalid-selection') {
        setNotice({ message: 'A choice is no longer available. Reload and choose again.', reload: true })
      } else if (body && typeof body === 'object' && 'status' in body && body.status === 'missing-profile') {
        setNotice({ message: 'Your profile could not be found. Please contact support.' })
      } else if (body && typeof body === 'object' && 'status' in body && body.status === 'invariant-failure') {
        setNotice({ message: 'Your profile needs attention. Please contact support.' })
      } else {
        setNotice({ message: 'Save failed. Please try again.' })
      }
    } catch {
      setNotice({ message: 'Save failed. Please try again.' })
    } finally {
      if (!navigating) { lock.current = false; setPending(false) }
    }
  }

  if (!choicesAvailable) return <div className="space-y-3">
    {initial.status === 'complete' && <SelectionSummary selection={initial.selection} />}
    <Feedback tone="error" message="Selection is unavailable. Please try again later." />
    {initial.status === 'complete' && <Link href={AUTH_PATHS.account} className={cx(btnBase, btnSm, btnGhost, focusRingNavy)}>Back to account</Link>}
  </div>

  return <form noValidate onSubmit={save} className="space-y-3">
    {initial.status === 'complete' && <div className="space-y-1">
      <h2 className="font-semibold text-ci-navy">Current selection</h2>
      <SelectionSummary selection={initial.selection} />
    </div>}
    <div className="space-y-2">
      <div className="space-y-1">
        <label htmlFor="department" className="block font-semibold text-ci-ink">Department</label>
        <select id="department" ref={departmentRef} required disabled={!ready || pending} className={selectClass}
          aria-invalid={notice?.field === 'departmentId'}
          aria-describedby={notice?.field === 'departmentId' ? FIELD_ERRORS.departmentId.id : undefined}
          value={draft.departmentId}
          onChange={event => {
            setDraft({ departmentId: event.target.value, academicLevelId: '', academicPeriodId: '' })
            setNotice(null)
          }}>
          <option value="">Choose department</option>
          {departments.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="academic-level" className="block font-semibold text-ci-ink">Level</label>
        <select id="academic-level" ref={academicLevelRef} required disabled={!ready || pending || !draft.departmentId}
          className={selectClass} aria-invalid={notice?.field === 'academicLevelId'}
          aria-describedby={notice?.field === 'academicLevelId' ? FIELD_ERRORS.academicLevelId.id : undefined}
          value={draft.academicLevelId}
          onChange={event => {
            setDraft(value => ({ ...value, academicLevelId: event.target.value, academicPeriodId: '' }))
            setNotice(null)
          }}>
          <option value="">Choose level</option>
          {academicLevels.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="academic-period" className="block font-semibold text-ci-ink">Semester</label>
        <select id="academic-period" ref={academicPeriodRef}
          required disabled={!ready || pending || !draft.departmentId || !draft.academicLevelId}
          className={selectClass} aria-invalid={notice?.field === 'academicPeriodId'}
          aria-describedby={notice?.field === 'academicPeriodId' ? FIELD_ERRORS.academicPeriodId.id : undefined}
          value={draft.academicPeriodId}
          onChange={event => {
            setDraft(value => ({ ...value, academicPeriodId: event.target.value }))
            setNotice(null)
          }}>
          <option value="">Choose semester</option>
          {academicPeriods.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
    </div>
    {notice && <div id={notice.field ? FIELD_ERRORS[notice.field].id : undefined} className="space-y-1">
      <Feedback compact tone="error" message={notice.message} />
      {notice.reload && <button type="button" className={cx(btnBase, btnSm, btnGhost, focusRingNavy)} onClick={() => window.location.reload()}>Reload choices</button>}
    </div>}
    <button type="submit" disabled={!ready || pending} aria-busy={pending}
      className={cx(btnBase, btnSm, btnNavy, 'w-full disabled:cursor-wait disabled:opacity-60', focusRingNavy)}>
      {pending ? 'Saving…' : 'Save selection'}
    </button>
    {initial.status === 'complete' && <Link href={AUTH_PATHS.account} className={cx(btnBase, btnSm, btnGhost, focusRingNavy)}>Back to account</Link>}
  </form>
}
