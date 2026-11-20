'use client'
// app/access/PlanChooser.tsx — The plans: the free month first while this student can claim it, then a Semester |
// Session switch directly above the Standard and Plus cards, the only ones it changes. Prices come from the catalogue
// through the server; every choice opens Confirm courses for that period directly.
import Link from 'next/link'
import { useState } from 'react'
import { btnNavy } from '@/components/chrome/ui'
import { Check } from 'lucide-react'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { PLAN_TIERS } from '@/lib/entitlements/contract'
import { CAMPUS_BOT_PLAN_LINE, PLAN_COPY, PLAN_PERIOD_NAME, PLAN_TIER_NAME, naira, sessionSavingBadge, sessionSavingLine, tierPrices }
  from '@/lib/entitlements/presentation'
import { checkoutHref } from '@/lib/payments/paths'
import type { PlanOnSale, PlanPeriod } from '@/lib/entitlements/contract'
import type { ReactElement, ReactNode } from 'react'

export function PlanChooser({ plans, first }: {
  plans: ReadonlyArray<PlanOnSale>
  /** A plan card the server puts ahead of the paid plans (the free month), as a list item. */
  first?: ReactNode
}): ReactElement {
  const sessionOffered = plans.some(plan => plan.period === 'session')
  const [period, setPeriod] = useState<PlanPeriod>('semester')
  const shown = sessionOffered ? period : 'semester'
  const savingBadge = sessionSavingBadge(plans)
  // The free month comes first and the switch sits directly above the paid plans it changes. On a desktop the free month
  // stands beside them, level with their cards, and the switch has a row of its own over the two paid cards. A free
  // month card on its own (no paid plan on sale) keeps the width of one plan card.
  const paid = plans.length > 0
  const beside = first !== undefined && paid
  const level = beside && sessionOffered ? ' desktop:row-start-2' : ''
  return <div className={'grid gap-4' + (beside ? ' desktop:grid-cols-3' : '')}>
    {first !== undefined && <ul className={'grid gap-4 tablet:grid-cols-2' +
      (beside ? ' desktop:grid-cols-1 desktop:col-start-1' + level : '')}>{first}</ul>}
    {sessionOffered && <fieldset className={'student-plan-switch' +
      (beside ? ' desktop:col-span-2 desktop:col-start-2 desktop:row-start-1' : '')}>
      <legend className="sr-only">{PLAN_COPY.periodSwitchLabel}</legend>
      {(['semester', 'session'] as const).map(value => <label key={value} className="student-plan-switch-option">
        <input type="radio" name="plan-period" value={value} checked={shown === value} onChange={() => setPeriod(value)} />
        <span>{PLAN_PERIOD_NAME[value]}{value === 'session' && savingBadge !== null &&
          <span className="student-plan-saving">{savingBadge}</span>}</span>
      </label>)}
    </fieldset>}
    {paid && <ul className={'grid gap-4 tablet:grid-cols-2' + (beside ? ' desktop:col-span-2 desktop:col-start-2' + level : '')}
      aria-live="polite">
      {PLAN_TIERS.map(tier => {
        const prices = tierPrices(plans, tier)
        const plan = shown === 'session' ? prices.session : prices.semester
        if (plan === null) return null
        const features = tier === 'standard'
          ? [PLAN_COPY.courses[plan.period], PLAN_COPY.study, CAMPUS_BOT_PLAN_LINE] : [PLAN_COPY.plusBenefit]
        return <li key={tier} className="student-surface flex h-full flex-col" data-plan={plan.plan}>
          <h3 className="text-xl font-bold text-student-text-primary">{PLAN_TIER_NAME[tier]}</h3>
          <p className="mt-1.5 text-sm text-student-text-secondary">{PLAN_COPY.cardLine[tier]}</p>
          <p className="mt-4 text-3xl font-bold tracking-tight text-student-text-primary">{naira(plan.price_kobo)}
            <span className="ml-1.5 text-base font-semibold text-student-text-secondary">{PLAN_COPY.perPeriod[plan.period]}</span></p>
          {plan.period === 'session' && <p className="mt-1 text-sm font-semibold text-student-primary">
            {sessionSavingLine(plan.price_kobo, prices.savingKobo)}</p>}
          {tier === 'plus' && <p className="mt-5 text-sm font-semibold text-student-text-primary">{PLAN_COPY.plusIntro}</p>}
          <ul className="mt-4 grid gap-3 text-sm text-student-text-primary">{features.map(feature => <li key={feature}
            className="flex items-start gap-2"><Check aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-student-primary" />
            <span>{feature}</span></li>)}</ul>
          <div className="mt-auto pt-5">
            <Link href={checkoutHref(plan.plan)} prefetch={false}
              className={studentAction(btnNavy, studentFocusDark, 'w-full')}>{PLAN_COPY.choose(tier)}</Link>
          </div>
        </li>
      })}
    </ul>}
  </div>
}
