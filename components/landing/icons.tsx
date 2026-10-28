// components/landing/icons.tsx — Lucide equivalents for the design's inline icons.
import { BookOpen, ClipboardCheck, Gift, GraduationCap, PenLine, RotateCcw, ShieldCheck, Timer, Upload, Users, Zap } from 'lucide-react'
import type { IconName } from '@/lib/landing/content'
import type { LucideIcon } from 'lucide-react'
import type { ReactElement } from 'react'

const ICONS: Record<IconName, LucideIcon> = {
  'past-questions': ClipboardCheck,
  notes: BookOpen,
  upload: Upload,
  theory: PenLine,
  exam: Timer,
  tutors: Users,
  faculty: GraduationCap,
  vetted: ShieldCheck,
  organised: RotateCcw,
  'free-trial': Gift,
  'quiz-ready': Zap,
}

/** Decorative icon; the adjacent text always carries the meaning. */
export function LandingIcon({ name, size = 22 }: { name: IconName; size?: number }): ReactElement {
  const Icon = ICONS[name]
  return <Icon aria-hidden="true" size={size} strokeWidth={2} />
}
