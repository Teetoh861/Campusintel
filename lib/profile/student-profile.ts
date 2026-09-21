// Current-student profile domain. No client-supplied profile identity enters this module.
import 'server-only'
import { z } from 'zod'
import { getStudentSessionUser } from '@/lib/auth/student-state'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { createClient } from '@/lib/supabase/server'
import { classifyStoredSelection, parseSubmittedSelection } from './selection'
import type { SelectionIds } from './selection'
import type { NextResponse } from 'next/server'

type StudentClient = Awaited<ReturnType<typeof createClient>>
type ReferenceTable = 'departments' | 'academic_levels' | 'academic_periods'
type StoredState = ReturnType<typeof classifyStoredSelection> | { kind: 'unavailable' } | { kind: 'missing-profile' }
const PROFILE_COLUMNS = 'department_id,academic_level_id,academic_period_id'

const referenceRowSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().min(1),
  is_active: z.boolean(),
}).strict()

type ReferenceRow = z.infer<typeof referenceRowSchema>
type References = {
  departments: ReferenceRow[]
  academicLevels: ReferenceRow[]
  academicPeriods: ReferenceRow[]
}
type Option = { id: string; label: string }
type SelectedOption = Option & { isActive: boolean }
type Options = {
  departments: Option[]
  academicLevels: Option[]
  academicPeriods: Option[]
}
type Selection = {
  department: SelectedOption
  academicLevel: SelectedOption
  academicPeriod: SelectedOption
}

export type StudentProfileState =
  | { status: 'signed-out' | 'missing-profile' | 'invariant-failure' | 'unavailable' | 'invalid-selection' }
  | { status: 'incomplete'; options: Options }
  | { status: 'complete'; options: Options; selection: Selection }

async function currentStudent(response?: NextResponse): Promise<{ client: StudentClient; id: string } | null> {
  const client = await createClient(response)
  const user = await getStudentSessionUser(response, client)
  return user === null ? null : { client, id: user.id }
}

async function readStoredSelection(client: StudentClient, id: string): Promise<StoredState> {
  const { data, error } = await client.from('profiles')
    .select(PROFILE_COLUMNS).eq('id', id).maybeSingle()
  if (error) return { kind: 'unavailable' }
  if (data === null) return { kind: 'missing-profile' }
  return classifyStoredSelection(data)
}

async function readReferenceRows(client: StudentClient, table: ReferenceTable): Promise<ReferenceRow[] | null> {
  const { data, error } = await client.from(table)
    .select('id,display_name,is_active').order('sort_order', { ascending: true })
  if (error) return null
  const result = referenceRowSchema.array().safeParse(data)
  return result.success && result.data.length > 0 ? result.data : null
}

async function readReferences(client: StudentClient): Promise<References | null> {
  const departments = await readReferenceRows(client, 'departments')
  if (departments === null) return null
  const academicLevels = await readReferenceRows(client, 'academic_levels')
  if (academicLevels === null) return null
  const academicPeriods = await readReferenceRows(client, 'academic_periods')
  if (academicPeriods === null) return null
  return { departments, academicLevels, academicPeriods }
}

function presentOptions(references: References): Options {
  const activeOptions = (rows: ReferenceRow[]) => rows
    .filter(row => row.is_active).map(row => ({ id: row.id, label: row.display_name }))
  return {
    departments: activeOptions(references.departments),
    academicLevels: activeOptions(references.academicLevels),
    academicPeriods: activeOptions(references.academicPeriods),
  }
}

function selectedOption(rows: ReferenceRow[], id: string): SelectedOption | null {
  const row = rows.find(candidate => candidate.id === id)
  return row ? { id: row.id, label: row.display_name, isActive: row.is_active } : null
}

function completeState(ids: SelectionIds, references: References): StudentProfileState {
  const department = selectedOption(references.departments, ids.departmentId)
  const academicLevel = selectedOption(references.academicLevels, ids.academicLevelId)
  const academicPeriod = selectedOption(references.academicPeriods, ids.academicPeriodId)
  if (!department || !academicLevel || !academicPeriod) return { status: 'invariant-failure' }
  return {
    status: 'complete',
    options: presentOptions(references),
    selection: { department, academicLevel, academicPeriod },
  }
}

/** Read only the live session owner's existing profile and ordered reference data. */
export async function getCurrentStudentProfile(response?: NextResponse): Promise<StudentProfileState> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const student = await currentStudent(response)
    if (student === null) return { status: 'signed-out' }
    const stored = await readStoredSelection(student.client, student.id)
    if (stored.kind === 'missing-profile') return { status: 'missing-profile' }
    if (stored.kind === 'unavailable') return { status: 'unavailable' }
    if (stored.kind === 'invariant-failure') return { status: 'invariant-failure' }
    const references = await readReferences(student.client)
    if (references === null) return { status: 'unavailable' }
    return stored.kind === 'incomplete'
      ? { status: 'incomplete', options: presentOptions(references) }
      : completeState(stored.ids, references)
  } catch { return { status: 'unavailable' } }
}

/** Update all three IDs in one owner-scoped statement after live Auth and catalogue checks. */
export async function saveCurrentStudentProfileSelection(input: unknown, response?: NextResponse): Promise<StudentProfileState> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const student = await currentStudent(response)
    if (student === null) return { status: 'signed-out' }
    const selection = parseSubmittedSelection(input)
    if (selection === null) return { status: 'invalid-selection' }
    const stored = await readStoredSelection(student.client, student.id)
    if (stored.kind === 'missing-profile') return { status: 'missing-profile' }
    if (stored.kind === 'unavailable') return { status: 'unavailable' }
    if (stored.kind === 'invariant-failure') return { status: 'invariant-failure' }
    const references = await readReferences(student.client)
    if (references === null) return { status: 'unavailable' }
    const chosen = [
      selectedOption(references.departments, selection.departmentId),
      selectedOption(references.academicLevels, selection.academicLevelId),
      selectedOption(references.academicPeriods, selection.academicPeriodId),
    ]
    if (chosen.some(option => option === null || !option.isActive)) return { status: 'invalid-selection' }

    // Recheck immediately before the write; catalogue reads may have taken time.
    const liveUser = await getStudentSessionUser(response, student.client)
    if (liveUser === null || liveUser.id !== student.id) return { status: 'signed-out' }
    const { data, error } = await student.client.from('profiles').update({
      department_id: selection.departmentId,
      academic_level_id: selection.academicLevelId,
      academic_period_id: selection.academicPeriodId,
    }).eq('id', student.id).select(PROFILE_COLUMNS).maybeSingle()
    if (error) return { status: 'unavailable' }
    if (data === null) return { status: 'missing-profile' }
    const updated = classifyStoredSelection(data)
    if (updated.kind !== 'complete' ||
        updated.ids.departmentId !== selection.departmentId ||
        updated.ids.academicLevelId !== selection.academicLevelId ||
        updated.ids.academicPeriodId !== selection.academicPeriodId) return { status: 'invariant-failure' }
    return completeState(updated.ids, references)
  } catch { return { status: 'unavailable' } }
}
