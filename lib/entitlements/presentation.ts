// lib/entitlements/presentation.ts — Plan copy and the one access notice a student sees, from the server summary.
// Every comparison uses the database's `now`, so the notice never depends on the viewer's clock.
import type { AccessSource, EntitlementSummary } from './contract'

const HOUR_MS = 3_600_000
// How long after a trial ends the "trial has ended" notice keeps showing.
const ENDED_NOTICE_DAYS = 14
const DAY_MS = 24 * HOUR_MS

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

/** Lagos time, the timezone every student is in. Server-side only, so client hydration stays deterministic. */
export function formatAccessDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : `${DATE_FORMAT.format(date)} (Lagos)`
}

export const ACCESS_SOURCE_LABEL: Record<AccessSource, string> = {
  trial: '7-day free trial',
  early_access: 'Early Access',
  manual: 'Full access',
  paid: 'Paid plan',
}

export type AccessNotice = { id: string; tone: 'info' | 'error'; title: string; body: string; action: string }

function msUntil(summary: EntitlementSummary, iso: string | null): number {
  return iso === null ? Number.NaN : Date.parse(iso) - Date.parse(summary.now)
}

/** The single most useful access message for this student now, or null when there is nothing to say. */
export function accessNotice(summary: EntitlementSummary): AccessNotice | null {
  const { early_access: early, trial, access } = summary
  const noticeWindow = summary.expiry_notice_hours * HOUR_MS
  if (access !== null) {
    const left = msUntil(summary, access.ends_at)
    if (left > 0 && left <= noticeWindow) {
      return { id: 'access-ending', tone: 'info',
        title: access.source === 'trial' ? 'Your free trial ends soon' : 'Your full access ends soon',
        body: `Your ${ACCESS_SOURCE_LABEL[access.source]} ends ${formatAccessDate(access.ends_at)}. ` +
          'Department courses lock after that. GST courses stay free.', action: 'View your plan' }
    }
  }
  if (early.status === 'awaiting-launch') {
    // No date is promised: the month starts when CampusIntell actually launches, never on the planned date.
    return { id: 'early-access-awaiting-launch', tone: 'info', title: 'You’re on the Early Access list',
      body: 'Your free month of full access starts automatically when CampusIntell launches publicly. ' +
        'There is nothing to claim, and a later launch never shortens your month.', action: 'View your plan' }
  }
  if (access !== null) return null
  if (trial.status === 'ended') {
    const since = -msUntil(summary, trial.ends_at)
    if (since >= 0 && since <= ENDED_NOTICE_DAYS * DAY_MS) {
      return { id: 'trial-ended', tone: 'info', title: 'Your free trial has ended',
        body: 'Department courses are locked again. GST courses stay free, and your saved bookmarks and results are kept.',
        action: 'View your plan' }
    }
    return null
  }
  if (trial.status === 'available') {
    return { id: 'trial-available', tone: 'info', title: 'Unlock your department courses',
      body: `Start a ${summary.trial_days}-day free trial with a one-time phone check. GST courses are always free.`,
      action: 'Start free trial' }
  }
  return null
}
