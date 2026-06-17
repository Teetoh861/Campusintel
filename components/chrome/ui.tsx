// Variant B shared UI atoms — button class strings (Tailwind utilities driven
// by the ci-* tokens) and the trailing arrow. Kept as plain strings/helpers so
// both Server and Client components can compose them. See component-spec.md →
// "Buttons (shared)".

// Base: inline-flex, gap 9px, weight 600, 16px, padding 14/24, radius 11px,
// min-height 52px, 1.5px transparent border. `group` enables the arrow nudge.
export const btnBase =
  'group inline-flex items-center justify-center gap-[9px] rounded-[11px] border-[1.5px] border-transparent px-6 py-[14px] min-h-[52px] text-base font-semibold leading-none tracking-[-0.01em] whitespace-nowrap transition-[transform,background-color,border-color,box-shadow] duration-150'

export const btnSm = 'min-h-[44px] rounded-[9px] px-[18px] py-[11px] text-[15px]'

// accent — primary on blue (amber, navy text, soft amber glow).
export const btnAccent =
  'bg-ci-accent text-ci-navy-900 shadow-[0_1px_1px_rgba(38,35,32,.04),0_10px_22px_-10px_rgba(224,163,62,.7)] hover:bg-ci-accent-600 hover:-translate-y-px'

// navy — solid brand blue, paper text.
export const btnNavy = 'bg-ci-navy text-ci-paper hover:bg-ci-navy-700 hover:-translate-y-px'

// white — the nav "Browse courses" button on the blue bar (navy text).
export const btnWhite = 'bg-white text-ci-navy hover:bg-ci-blue-50'

// ghost on paper — transparent, navy text, hairline outline.
export const btnGhost = 'bg-transparent text-ci-navy border-ci-border-2 hover:bg-ci-white hover:border-ci-blue-200'

// ghost on the blue field (hero) — white outline.
export const btnGhostOnBlue =
  'bg-transparent text-white border-white/45 hover:bg-white/10 hover:border-white/70'

// light — on the deep-blue closing band (paper fill, navy text).
export const btnLight = 'bg-ci-paper text-ci-navy hover:bg-ci-white hover:-translate-y-px'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// Trailing arrow that nudges +3px on hover of the enclosing `group`.
export function Arrow() {
  return (
    <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-[3px]">
      &rarr;
    </span>
  )
}
