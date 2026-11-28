// app/access/UsageBars.tsx — Campus Bot use: one bar for the session, one for the week, each with when it resets. No
// numbers are shown; the bar's state is also said in words, never by colour alone.
import { USAGE_COPY, usageLevel } from '@/lib/entitlements/presentation'
import type { CampusBotUsage, CampusBotWindow } from '@/lib/ai-practice/campus-bot-usage'
import type { ReactElement } from 'react'

function Bar({ label, window, resets }: { label: string; window: CampusBotWindow; resets: string }): ReactElement {
  const level = usageLevel(window)
  return <div className="grid gap-1.5" data-usage-level={level.key}>
    <div className="flex items-baseline justify-between gap-3">
      <p className="font-semibold text-student-text-primary">{label}</p>
      <p className="text-sm font-semibold text-student-text-primary">{level.words}</p>
    </div>
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level.usedPercent}
      aria-valuetext={`${level.words}. ${resets}`} className="student-usage-bar">
      <span style={{ width: `${level.usedPercent}%` }} />
    </div>
    <p className="text-sm text-student-text-secondary">{resets}</p>
  </div>
}

export function UsageBars({ usage }: { usage: Extract<CampusBotUsage, { state: 'tokens' }> }): ReactElement {
  return <div className="student-surface grid gap-4">
    <h2 id="usage-heading" className="student-section-title">{USAGE_COPY.heading}</h2>
    <Bar label={USAGE_COPY.session} window={usage.session}
      resets={usage.session.resetsAt === null ? USAGE_COPY.notStarted : USAGE_COPY.sessionResets(usage.session.resetsAt)} />
    <Bar label={USAGE_COPY.week} window={usage.week}
      resets={usage.week.resetsAt === null ? USAGE_COPY.notStarted : USAGE_COPY.weekResets(usage.week.resetsAt)} />
  </div>
}
