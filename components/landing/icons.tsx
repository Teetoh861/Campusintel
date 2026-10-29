// components/landing/icons.tsx — Landing icons: general icons from lucide-react, brand marks from the brands' official files.
// No hand-drawn SVG and no emoji: brand glyphs are the owners' PNG assets in public/landing/icons/.
import Image from 'next/image'
import { BookOpen, CircleCheck, FileText, FileUp, GraduationCap, Library, ListChecks, PenLine, ShieldCheck, Ticket, Timer, Users } from 'lucide-react'
import type { IconName } from '@/lib/landing/content'
import type { LucideIcon } from 'lucide-react'
import type { ReactElement } from 'react'

const ICONS: Record<IconName, LucideIcon> = {
  'past-questions': ListChecks,
  notes: FileText,
  'gst-free': BookOpen,
  upload: FileUp,
  theory: PenLine,
  exam: Timer,
  tutors: Users,
  faculty: GraduationCap,
  vetted: ShieldCheck,
  organised: Library,
  'free-trial': Ticket,
  'quiz-ready': CircleCheck,
}

/** Official white brand glyphs (WhatsApp Brand Resource Center, Instagram brand asset pack), scaled only.
 * Marks appear only on Navy or Blue; on white or Sky they sit inside a Navy button, otherwise the words stand alone. */
export const BRAND_ICONS = {
  whatsapp: { src: '/landing/icons/whatsapp-glyph-white.png', width: 96, height: 96 },
  instagram: { src: '/landing/icons/instagram-glyph-white.png', width: 96, height: 96 },
} as const

export type BrandName = keyof typeof BRAND_ICONS

/** Decorative icon; the adjacent text always carries the meaning. */
export function LandingIcon({ name, size = 22 }: { name: IconName; size?: number }): ReactElement {
  const Icon = ICONS[name]
  return <Icon aria-hidden="true" size={size} strokeWidth={2} />
}

/** Decorative 18px white brand glyph beside its link text, unaltered apart from size. */
export function BrandIcon({ name }: { name: BrandName }): ReactElement {
  const icon = BRAND_ICONS[name]
  return <Image src={icon.src} width={icon.width} height={icon.height} alt="" sizes="18px"
    className="h-[18px] w-[18px] shrink-0 object-contain" />
}
