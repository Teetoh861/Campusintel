// lib/payments/paths.ts — Where the plan and payment screens live (client-safe).
import type { PlanKey } from '@/lib/entitlements/contract'

export const PAYMENT_TERMS_PATH = '/payment-terms'
export const CHECKOUT_PATH = '/access/checkout'
export const RECEIPTS_PATH = '/access/receipts'

/** Confirm courses for one plan: every Pay goes here first. */
export function checkoutHref(plan: PlanKey): string {
  return `${CHECKOUT_PATH}?plan=${plan}`
}
