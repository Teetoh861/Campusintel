// Variant B brand mark — a refined line-segment open book whose strokes follow
// `currentColor` (so it goes white on the blue nav, navy in the footer) plus a
// separate amber bookmark detail. Source: component-spec.md → Nav / Footer.
import { cx } from './ui'

export function BookLogo({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M20 11.5C16.8 9.3 13 8.6 9.2 9.1c-.7.1-1.2.7-1.2 1.4v17.1c0 .9.8 1.5 1.6 1.4 3.4-.4 6.9.3 10.4 2.6"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M20 11.5c3.2-2.2 7-2.9 10.8-2.4.7.1 1.2.7 1.2 1.4v17.1c0 .9-.8 1.5-1.6 1.4-3.4-.4-6.9.3-10.4 2.6"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line x1="20" y1="11.5" x2="20" y2="31.6" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <path
        d="M25.4 8.9v7.3l-2.4-1.8-2.4 1.8"
        stroke="#E0A33E"
        strokeWidth="2.3"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

// Wordmark "Campus Intell" with a hair-thin space between the words.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('font-extrabold tracking-[-0.025em] whitespace-nowrap', className)}>
      Campus{' '}Intell
    </span>
  )
}
