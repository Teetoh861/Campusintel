// lib/entitlements/presentation.ts — Plan copy and the one access notice a student sees, from the server summary.
// Every comparison uses the database's `now`, so the notice never depends on the viewer's clock.
import { discoveryOffered } from './contract'
import { DISCOVERY_KINDS } from './discovery-contract'
import type { AccessSource, EntitlementSummary, TrialPolicy } from './contract'
import type { DiscoveryKind } from './discovery-contract'

const HOUR_MS = 3_600_000
// How long after a Discovery Pass ends the "pass has ended" notice keeps showing.
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
  // A seven-day trial issued before the Discovery Pass replaced it.
  trial: 'Free trial',
  early_access: 'Early Access',
  manual: 'Full access',
  paid: 'Paid plan',
}

export const DISCOVERY_PASS_LABEL = 'Discovery Pass'

/** What the student's own trial is called: a Discovery Pass, or the seven-day trial they were issued earlier. */
export function trialLabel(summary: EntitlementSummary): string {
  return summary.trial.policy === 'seven-day' ? 'free trial' : DISCOVERY_PASS_LABEL
}

/**
 * What a surface may say about the student's trial, from their own grant rather than from what the database could
 * issue: `policy` names the grant they actually hold (a Discovery Pass, a seven-day trial issued before the pass, or
 * null when there is none or the plan could not be read), and `passAvailable` says whether a pass can still be
 * started from Plan & Access (the database offers one and this account has not had its trial).
 */
export type TrialWording = { policy: TrialPolicy | null; passAvailable: boolean }

/** Neutral: no pass is advertised and the grant is called a trial, never a Discovery Pass. */
export const NEUTRAL_TRIAL_WORDING: TrialWording = Object.freeze({ policy: null, passAvailable: false })

export function trialWording(summary: EntitlementSummary | null | undefined): TrialWording {
  if (summary == null) return NEUTRAL_TRIAL_WORDING
  return { policy: summary.trial.policy, passAvailable: discoveryOffered(summary) && summary.trial.status === 'available' }
}

/** The name of a trial grant in running copy ("your …"): accurate for the grant held, neutral when unknown. */
export function trialGrantName(policy: TrialPolicy | null): string {
  return policy === 'discovery' ? DISCOVERY_PASS_LABEL : policy === 'seven-day' ? 'free trial' : 'trial access'
}

/** The preview names a student sees, in the order the course page offers them. */
export const DISCOVERY_PREVIEW_LABEL: Record<DiscoveryKind, string> = {
  cbt: 'CBT exam',
  study_guide: 'study guide topic',
}

export type AccessNotice = { id: string; tone: 'info' | 'error'; title: string; body: string; action: string }

function msUntil(summary: EntitlementSummary, iso: string | null): number {
  return iso === null ? Number.NaN : Date.parse(iso) - Date.parse(summary.now)
}

/** The previews this pass has not used yet, by their student-facing names. */
export function unusedPreviews(summary: EntitlementSummary): DiscoveryKind[] {
  if (!discoveryOffered(summary)) return []
  const used = new Set(summary.discovery.previews.map(preview => preview.kind))
  return DISCOVERY_KINDS.filter(kind => !used.has(kind))
}

function listOf(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** The single most useful access message for this student now, or null when there is nothing to say. */
export function accessNotice(summary: EntitlementSummary): AccessNotice | null {
  const { early_access: early, trial, access } = summary
  const noticeWindow = summary.expiry_notice_hours * HOUR_MS
  if (access !== null) {
    const left = msUntil(summary, access.ends_at)
    if (left > 0 && left <= noticeWindow) {
      return { id: 'access-ending', tone: 'info', title: 'Your full access ends soon',
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
  if (trial.status === 'active' && trial.ends_at !== null) {
    const left = msUntil(summary, trial.ends_at)
    const unused = unusedPreviews(summary).map(kind => DISCOVERY_PREVIEW_LABEL[kind])
    const toTry = unused.length > 0 ? ` Still to use: your ${listOf(unused)}, on a department course you choose.` : ''
    return { id: left <= noticeWindow ? 'discovery-ending' : 'discovery-active', tone: 'info',
      title: left <= noticeWindow ? `Your ${DISCOVERY_PASS_LABEL} ends soon` : `Your ${DISCOVERY_PASS_LABEL} is active`,
      body: `It ends ${formatAccessDate(trial.ends_at)}.${toTry}`, action: 'See what’s included' }
  }
  if (trial.status === 'ended') {
    const since = -msUntil(summary, trial.ends_at)
    if (since >= 0 && since <= ENDED_NOTICE_DAYS * DAY_MS) {
      return { id: 'trial-ended', tone: 'info', title: `Your ${trialLabel(summary)} has ended`,
        body: 'GST courses stay free, and your saved bookmarks and results are kept.', action: 'View your plan' }
    }
    return null
  }
  if (trial.status === 'available' && discoveryOffered(summary)) {
    return { id: 'trial-available', tone: 'info', title: 'Preview your department courses',
      body: `A free ${summary.trial_hours}-hour ${DISCOVERY_PASS_LABEL} includes one full ` +
        `${summary.discovery.cbt_questions}-question CBT exam and one complete study guide topic, from courses you ` +
        'choose. GST courses are always free.', action: 'Get your pass' }
  }
  return null
}
