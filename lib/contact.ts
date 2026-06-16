// Shared, non-secret contact details. Single source of truth for the support
// email and the human-readable phone display.
//
// The WhatsApp / call number itself lives in lib/whatsapp.ts (read from the
// NEXT_PUBLIC_WHATSAPP_NUMBER env var). The phone display below is *derived*
// from that same value rather than hardcoded, so the two can never drift —
// which is also why there's no standalone CONTACT_PHONE constant: the number
// is already centralized in WHATSAPP_NUMBER.
import { WHATSAPP_NUMBER } from './whatsapp'

export const CONTACT_EMAIL = 'support@campusintell.com'

// Local-format (Nigerian) rendering of the support number, derived from
// WHATSAPP_NUMBER: "2349018750976" -> "0901-875-0976". Falls back to the raw
// digits for any non-13-digit / non-234 configuration.
export function contactPhoneDisplay(): string {
  const digits = WHATSAPP_NUMBER
  if (digits.length === 13 && digits.startsWith('234')) {
    const local = `0${digits.slice(3)}`
    return `${local.slice(0, 4)}-${local.slice(4, 7)}-${local.slice(7)}`
  }
  return digits
}
