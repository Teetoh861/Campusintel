// WhatsApp helper. Single source of truth for the support number — read
// from NEXT_PUBLIC_WHATSAPP_NUMBER so it can vary between local, preview and
// production without rebuilding the page tree. Empty fallback intentional:
// if the env var is missing in dev the build still succeeds, but `wa.me/`
// links are obviously inert at runtime so the missing config surfaces fast.
//
// Format expected: digits-only country code + number, e.g. "2349018750976"
// (no leading +, spaces or hyphens).
export const WHATSAPP_NUMBER: string =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? ''

const WA_BASE = 'https://wa.me/'

export function buildWhatsAppUrl(message?: string): string {
  const base = `${WA_BASE}${WHATSAPP_NUMBER}`
  if (!message) return base
  return `${base}?text=${encodeURIComponent(message)}`
}

// Course changes during a locked semester go through the team. Generic on purpose: no name, email or course in the
// link (D10); the team asks for the account email in the chat.
export const COURSE_CHANGE_MESSAGE = 'Hello CampusIntell, I need a change to my courses for this semester.'
const WHATSAPP_NUMBER_FORMAT = /^[0-9]{8,15}$/

/** Where "Message us" goes: WhatsApp when a number is configured, otherwise Help & Support. */
export function courseChangeContact(fallback: string, number: string = WHATSAPP_NUMBER): { href: string; external: boolean } {
  return WHATSAPP_NUMBER_FORMAT.test(number)
    ? { href: `${WA_BASE}${number}?text=${encodeURIComponent(COURSE_CHANGE_MESSAGE)}`, external: true }
    : { href: fallback, external: false }
}
