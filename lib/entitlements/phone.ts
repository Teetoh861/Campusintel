// lib/entitlements/phone.ts — Typed entry to the shared phone rules (phone.cjs is also used by the operator tool).
export { normalizeNigerianMobile, phoneHash } from './phone.cjs'

export type NormalizedPhone = { e164: string; hint: string }
