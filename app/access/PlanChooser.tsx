'use client'
// app/access/PlanChooser.tsx — The plans: the free month first while this student can claim it, then a Semester |
// Session switch directly above the Standard and Plus cards, the only ones it changes. Prices come from the catalogue
// through the server; Pay always opens Confirm courses first. Choosing Semester first offers the Session.
import Link from 'next/link'
import { useState } from 'react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PLAN_TIERS } from '@/lib/entitlements/contract'
import { PLAN_COPY, PLAN_PERIOD_NAME, naira, planName, semesterPromptLine, sessionSavingLine, tierPrices }
  from '@/lib/entitlements/presentation'
import { checkoutHref } from '@/lib/payments/paths'
import type { PlanOnSale, PlanPeriod, PlanTier } from '@/lib/entitlements/contract'
import type { ReactElement, ReactNode } from 'react'

export function PlanChooser({ plans, first }: {
  plans: ReadonlyArray<PlanOnSale>
  /** A plan card the server puts ahead of the paid plans (the free month), as a list item. */
  first?: ReactNode
}): ReactElement {
  const sessionOffered = plans.some(plan => plan.period === 'session')
  const [period, setPeriod] = useState<PlanPeriod>('semester')
  const [prompt, setPrompt] = useState<PlanTier | null>(null)
  const shown = sessionOffered ? period : 'semester'
  const prompted = prompt === null ? null : tierPrices(plans, prompt)
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
        <span>{PLAN_PERIOD_NAME[value]}</span>
      </label>)}
    </fieldset>}
    {paid && <ul className={'grid gap-4 tablet:grid-cols-2' + (beside ? ' desktop:col-span-2 desktop:col-start-2' + level : '')}
      aria-live="polite">
      {PLAN_TIERS.map(tier => {
        const prices = tierPrices(plans, tier)
        const plan = shown === 'session' ? prices.session : prices.semester
        if (plan === null) return null
        const pay = `Pay ${naira(plan.price_kobo)}`
        return <li key={tier} className="student-surface flex h-full flex-col" data-plan={plan.plan}>
          <h3 className="font-bold text-student-text-primary">{planName(tier, plan.period)}</h3>
          <p className="mt-1.5 text-3xl font-bold tracking-tight text-student-text-primary">{naira(plan.price_kobo)}
            <span className="ml-1.5 text-base font-semibold text-student-text-secondary">{PLAN_COPY.perPeriod[plan.period]}</span></p>
          {plan.period === 'session' && prices.savingKobo > 0 && <p className="mt-1 text-sm font-semibold text-student-primary">
            {sessionSavingLine(prices.savingKobo)}</p>}
          <p className="mt-3 text-sm text-student-text-secondary">{PLAN_COPY.cardLine[tier]}</p>
          <div className="mt-auto pt-5">
            {plan.period === 'semester' && prices.session !== null
              ? <button type="button" onClick={() => setPrompt(tier)}
                className={studentAction(btnNavy, studentFocusDark, 'w-full')}>{pay}</button>
              : <Link href={checkoutHref(plan.plan)} prefetch={false}
                className={studentAction(btnNavy, studentFocusDark, 'w-full')}>{pay}</Link>}
          </div>
        </li>
      })}
    </ul>}
    <Dialog open={prompt !== null} onOpenChange={open => { if (!open) setPrompt(null) }}>
      {prompt !== null && prompted?.semester && prompted.session && <DialogContent className="student-plan-dialog">
        <DialogTitle className="text-left text-xl font-bold text-student-text-primary">{planName(prompt, 'session')}</DialogTitle>
        <DialogDescription className="text-left text-base text-student-text-secondary">
          {semesterPromptLine(prompted.session.price_kobo, prompted.savingKobo)}
        </DialogDescription>
        <div className="mt-2 grid gap-2 tablet:flex tablet:justify-end">
          <Link href={checkoutHref(prompted.semester.plan)} prefetch={false}
            className={studentAction(btnGhost, 'bg-student-surface')}>{PLAN_COPY.keepSemester}</Link>
          <Link href={checkoutHref(prompted.session.plan)} prefetch={false}
            className={studentAction(btnNavy, studentFocusDark)}>{PLAN_COPY.switchToSession}</Link>
        </div>
      </DialogContent>}
    </Dialog>
  </div>
}
