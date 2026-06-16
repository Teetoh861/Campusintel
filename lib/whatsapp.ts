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
