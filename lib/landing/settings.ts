// lib/landing/settings.ts — Optional landing links from public settings; an unset or unsafe value hides its action.
import { whatsAppChatUrl } from '@/lib/whatsapp'

export type LandingLinks = {
  /** NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: the student WhatsApp community invite. */
  community: string | null
  /** NEXT_PUBLIC_EARLY_ACCESS_FORM_URL: the pre-launch Early Access sign-up form. */
  earlyAccess: string | null
  /** WhatsApp chat with the team, pre-filled with the waitlist request. */
  waitlist: string | null
  /** WhatsApp chat with the team, without a message. */
  whatsApp: string | null
}

/** Accept only absolute https URLs so a mistyped setting can never become a script or relative link. */
export function httpsUrlOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** Resolve every optional landing action once on the server; each null hides its button. */
export function landingLinks(waitlistMessage: string): LandingLinks {
  return {
    community: httpsUrlOrNull(process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL),
    earlyAccess: httpsUrlOrNull(process.env.NEXT_PUBLIC_EARLY_ACCESS_FORM_URL),
    waitlist: whatsAppChatUrl(waitlistMessage),
    whatsApp: whatsAppChatUrl(),
  }
}
