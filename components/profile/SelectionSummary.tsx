import type { StudentProfileState } from '@/lib/profile/student-profile'

type Selection = Extract<StudentProfileState, { status: 'complete' }>['selection']

/** Show the persisted labels, including historical choices that are no longer selectable. */
export function SelectionSummary({ selection }: { selection: Selection }) {
  const rows = [
    ['Department', selection.department],
    ['Level', selection.academicLevel],
    ['Semester', selection.academicPeriod],
  ] as const
  return <dl className="divide-y divide-ci-border rounded-ci-btn border border-ci-border bg-ci-paper px-3">
    {rows.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-3 py-2 text-sm">
      <dt className="font-semibold text-ci-gray-700">{label}</dt>
      <dd className="text-right text-ci-ink">{value.label}{!value.isActive &&
        <span className="ml-1 text-ci-gray-700">(no longer available)</span>}</dd>
    </div>)}
  </dl>
}
