// app/profile-selection/ProfileSelectionForm.tsx — Real name and academic setup through the continuity-bound server API.
'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { Feedback } from '@/components/chrome/Feedback'
import { btnBase, buttonClassName, btnGhost, btnNavy, btnSm, cx } from '@/components/chrome/ui'
import { studentFocusControl, studentFocusDark } from '@/components/student/ui'
import { SelectionSummary } from '@/components/profile/SelectionSummary'
import { AUTH_CONTINUITY_HEADER, AUTH_PATHS, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { FIRST_NAME_ERROR, FIRST_NAME_MAX_LENGTH, firstNameSchema } from '@/lib/profile/first-name'
import type { StudentProfileState } from '@/lib/profile/student-profile'
import type { FormEvent, ReactElement } from 'react'

const focusRingNavy = studentFocusControl

type ProfileView = Extract<StudentProfileState, { status: 'incomplete' | 'complete' }>
type Draft = { departmentId: string; academicLevelId: string; academicPeriodId: string; first_name: string }
type Choice = { id: string; label: string }
type Field = keyof Draft
type Notice = { message: string; reload?: boolean; field?: Field }

const FIELD_ERRORS: Record<Field, { id: string; message: string }> = {
  first_name: { id: 'first-name-error', message: FIRST_NAME_ERROR },
  departmentId: { id: 'department-error', message: 'Choose a department.' },
  academicLevelId: { id: 'academic-level-error', message: 'Choose a level.' },
  academicPeriodId: { id: 'academic-period-error', message: 'Choose a semester.' },
}

const PROFILE_API = '/api/profile-selection'
const savedResponseSchema = z.object({
  status: z.literal('complete'),
  firstName: firstNameSchema,
  selection: z.object({
    department: z.object({ id: z.string().uuid(), label: z.string().min(1), isActive: z.literal(true) }),
    academicLevel: z.object({ id: z.string().uuid(), label: z.string().min(1), isActive: z.literal(true) }),
    academicPeriod: z.object({ id: z.string().uuid(), label: z.string().min(1), isActive: z.literal(true) }),
  }),
})

const selectClass = cx('h-12 w-full rounded-ci-btn border border-student-control-border bg-student-elevated-surface px-3 py-2 text-base text-student-text-primary',
  'disabled:cursor-not-allowed disabled:opacity-60', focusRingNavy)

function selectedId(choice: { id: string }, options: Choice[]): string {
  return options.some(option => option.id === choice.id) ? choice.id : ''
}

function initialDraft(initial: ProfileView): Draft {
  if (!initial.selection) return { first_name: initial.firstName ?? '', departmentId: '', academicLevelId: '', academicPeriodId: '' }
  return {
    first_name: initial.firstName ?? '',
    departmentId: selectedId(initial.selection.department, initial.options.departments),
    academicLevelId: selectedId(initial.selection.academicLevel, initial.options.academicLevels),
    academicPeriodId: selectedId(initial.selection.academicPeriod, initial.options.academicPeriods),
  }
}

function isSelectable(options: Choice[], id: string): boolean {
  return id !== '' && options.some(option => option.id === id)
}

/** Keep only a draft in browser memory; successful navigation requires a confirmed server save. */
export function ProfileSelectionForm({ initial, continuityToken }: { initial: ProfileView; continuityToken: string }): ReactElement {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(initial))
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState(false)
  const [ready, setReady] = useState(false)
  const lock = useRef(false)
  // A later RSC payload must not re-label this mounted draft as another account's.
  const pageToken = useRef(continuityToken).current
  const departmentRef = useRef<HTMLSelectElement>(null)
  const firstNameRef = useRef<HTMLInputElement>(null)
  const academicLevelRef = useRef<HTMLSelectElement>(null)
  const academicPeriodRef = useRef<HTMLSelectElement>(null)
  const { departments, academicLevels, academicPeriods } = initial.options
  const choicesAvailable = departments.length > 0 && academicLevels.length > 0 && academicPeriods.length > 0

  useEffect(() => { setReady(true) }, [])
  useEffect(() => {
    if (notice?.field === 'first_name') firstNameRef.current?.focus()
    else if (notice?.field === 'departmentId') departmentRef.current?.focus()
    else if (notice?.field === 'academicLevelId') academicLevelRef.current?.focus()
    else if (notice?.field === 'academicPeriodId') academicPeriodRef.current?.focus()
  }, [notice?.field])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || lock.current) return
    const name = firstNameSchema.safeParse(draft.first_name)
    const missingField: Field | null = !name.success ? 'first_name'
      : !isSelectable(departments, draft.departmentId) ? 'departmentId'
      : !isSelectable(academicLevels, draft.academicLevelId) ? 'academicLevelId'
        : !isSelectable(academicPeriods, draft.academicPeriodId) ? 'academicPeriodId' : null
    if (missingField) {
      setNotice({ message: FIELD_ERRORS[missingField].message, field: missingField })
      if (notice?.field === missingField) {
        if (missingField === 'first_name') firstNameRef.current?.focus()
        else if (missingField === 'departmentId') departmentRef.current?.focus()
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
            parsed.data.selection.academicPeriod.id === draft.academicPeriodId &&
            parsed.data.firstName === draft.first_name.trim()) {
          navigating = true
          window.location.replace(STUDENT_HOME_PATH)
          return
        }
        setNotice({ message: 'Save could not be confirmed. Reload the page.', reload: true })
      } else if (body && typeof body === 'object' && 'status' in body && body.status === 'invalid-selection') {
        setNotice({ message: 'Review your first name and choices, or reload if a choice is no longer available.', reload: true })
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

  if (!choicesAvailable) return <div className="student-surface student-surface-raised space-y-3">
    {initial.status === 'complete' && <div className="space-y-2">
      <h2 className="font-semibold text-student-text-primary">Current selection</h2>
      <SelectionSummary selection={initial.selection} />
    </div>}
    <Feedback tone="error" message="Selection is unavailable. Please try again later." />
    {initial.status === 'complete' && <Link href={AUTH_PATHS.account} className={buttonClassName(btnBase, btnSm, btnGhost, focusRingNavy)}>Back to account</Link>}
  </div>

  return <form noValidate onSubmit={save} className="student-surface student-surface-raised grid gap-4">
    {initial.status === 'complete' && <section aria-labelledby="current-selection-heading" className="space-y-2">
      <h2 id="current-selection-heading" className="font-semibold text-student-text-primary">Current selection</h2>
      <SelectionSummary selection={initial.selection} />
    </section>}
    <div className="grid gap-3 tablet:grid-cols-2 tablet:gap-4">
      <div className="space-y-1 tablet:col-span-2">
        <label htmlFor="first-name" className="block font-semibold text-student-text-primary">First name</label>
        <input id="first-name" name="first_name" ref={firstNameRef} type="text" autoComplete="given-name"
          required maxLength={FIRST_NAME_MAX_LENGTH * 2} disabled={!ready || pending} className={selectClass}
          aria-invalid={notice?.field === 'first_name'}
          aria-describedby={notice?.field === 'first_name' ? FIELD_ERRORS.first_name.id : undefined}
          value={draft.first_name} onChange={event => { setDraft(value => ({ ...value, first_name: event.target.value })); setNotice(null) }} />
      </div>
      <div className="space-y-1 tablet:col-span-2">
        <label htmlFor="department" className="block font-semibold text-student-text-primary">Department</label>
        <select id="department" ref={departmentRef} required disabled={!ready || pending} className={selectClass}
          aria-invalid={notice?.field === 'departmentId'}
          aria-describedby={notice?.field === 'departmentId' ? FIELD_ERRORS.departmentId.id : undefined}
          value={draft.departmentId}
          onChange={event => {
            setDraft(value => ({ ...value, departmentId: event.target.value, academicLevelId: '', academicPeriodId: '' }))
            setNotice(null)
          }}>
          <option value="">Choose department</option>
          {departments.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="academic-level" className="block font-semibold text-student-text-primary">Level</label>
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
        <label htmlFor="academic-period" className="block font-semibold text-student-text-primary">Semester</label>
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
      {notice.reload && <button type="button" className={buttonClassName(btnBase, btnSm, btnGhost, focusRingNavy)} onClick={() => window.location.reload()}>Reload choices</button>}
    </div>}
    <div className="flex flex-col gap-2 tablet:flex-row tablet:items-center">
      <button type="submit" disabled={!ready || pending} aria-busy={pending}
        className={buttonClassName(btnBase, btnSm, btnNavy, 'w-full disabled:cursor-wait disabled:opacity-60 tablet:w-auto', studentFocusDark)}>
        {pending ? 'Saving…' : 'Save selection'}
      </button>
      {initial.status === 'complete' && <Link href={AUTH_PATHS.account}
        className={buttonClassName(btnBase, btnSm, btnGhost, focusRingNavy, 'w-full tablet:w-auto')}>
        Back to account
      </Link>}
    </div>
  </form>
}
