// lib/payments/money.ts — Exact conversion between kobo integers (our database) and Bachs' decimal strings ("4000.00").
// No floating point anywhere: a string that is not a plain non-negative decimal with at most two places is refused.
import 'server-only'

// Two places at most, no sign, no exponent, no separators; 13 integer digits covers any amount we could sell.
const DECIMAL = /^(\d{1,13})(?:\.(\d{1,2}))?$/

/** Kobo to the decimal string Bachs expects for NGN: 400000 → "4000.00". */
export function koboToDecimal(kobo: number): string {
  if (!Number.isSafeInteger(kobo) || kobo < 0) throw new RangeError('Amount must be a non-negative whole number of kobo')
  const naira = Math.floor(kobo / 100)
  return `${naira}.${String(kobo % 100).padStart(2, '0')}`
}

/** A provider decimal string to kobo, or null when it is not an exact two-place amount: "4000.5" → 400050. */
export function decimalToKobo(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = DECIMAL.exec(value)
  if (match === null) return null
  const kobo = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(kobo) ? kobo : null
}
