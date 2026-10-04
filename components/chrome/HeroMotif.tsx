// HeroMotif — Variant B decorative geometry that replaces the dossier
// aperture-C: a soft rounded "blob" sitting behind the hero art plus a small
// dashed-stroke ring top-right. Renders as an absolutely-positioned,
// pointer-events-none layer, so it sits behind whatever sibling art a page
// places over it (the homepage product-preview card). The parent should be
// position:relative. (component-spec.md → HeroMotif)
import type { CSSProperties } from 'react'

type Props = {
  // on-blue: white-on-navy gradient + brighter ring (homepage hero).
  // on-cream: warm blue-50 → paper-2 gradient + softer ring.
  tone?: 'on-blue' | 'on-cream'
  // Restrict to a single element if needed; default renders blob + ring.
  shape?: 'blob' | 'ring'
  className?: string
  style?: CSSProperties
}

export function HeroMotif({ tone = 'on-cream', shape, className, style }: Props) {
  const blobBg =
    tone === 'on-blue'
      ? 'radial-gradient(120% 120% at 70% 20%, var(--student-navigation-wash-start), var(--student-navigation-wash-end))'
      : 'radial-gradient(120% 120% at 70% 20%, var(--student-motif-light-start), var(--student-motif-light-end))'
  const ringColor = tone === 'on-blue' ? 'text-student-navigation-ring' : 'text-student-motif-light-ring'

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 ${className ?? ''}`}
      style={style}
    >
      {shape !== 'ring' && (
        <span
          className="absolute left-[-9%] top-[-2%] h-[108%] w-[118%] rounded-[32px]"
          style={{ background: blobBg }}
        />
      )}
      {shape !== 'blob' && (
        <svg
          className={`absolute right-[8%] top-[-6px] z-[1] h-[54px] w-[54px] ${ringColor}`}
          viewBox="0 0 54 54"
          fill="none"
        >
          <circle
            cx="27"
            cy="27"
            r="20"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeDasharray="3 7"
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
  )
}
