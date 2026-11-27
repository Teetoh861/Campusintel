// components/landing/fonts.ts — The landing display typeface, self-hosted by next/font. Body text uses the app's own
// Hanken Grotesk from the root layout, so the page loads two font files: this one and the app's.
import localFont from 'next/font/local'

export const landingDisplay = localFont({
  src: [
    { path: '../../app/fonts/CampusDisplay-Latin.woff2', weight: '700', style: 'normal' },
    { path: '../../app/fonts/CampusDisplay-Latin.woff2', weight: '800', style: 'normal' },
  ],
  adjustFontFallback: 'Times New Roman',
  display: 'swap',
  variable: '--landing-display',
})
