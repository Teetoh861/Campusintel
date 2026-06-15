// HeroMotif — the large decorative aperture-C that bleeds off the right edge
// in page headers. One shared component so positioning stays identical on
// every page (the original comps used different right/width offsets per
// page and occasionally clipped the signal dot on mobile).
//
// The dot-on-screen guarantee:
//   dot center sits at viewBox x≈84.5 of 100, radius 3.1 of 100
//   campusintel.css pins mobile width:240px / right:-14px → dot's right edge
//   lands ≈15.76px inside the viewport, vertically centred. Tablet and
//   desktop offsets in campusintel.css preserve the same clearance.
// Rendering through this single component prevents future drift.
import type { CSSProperties } from 'react'

type Props = {
  className?: string
  style?: CSSProperties
}

export function HeroMotif({ className, style }: Props) {
  const cls = className ? `hero-motif ${className}` : 'hero-motif'
  return (
    <svg className={cls} style={style} viewBox="0 0 100 100" aria-hidden="true">
      <path
        d="M 76.2 68.35 A 32 32 0 1 1 76.2 31.65"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="84.5" cy="50" r="3.1" fill="currentColor" />
    </svg>
  )
}
