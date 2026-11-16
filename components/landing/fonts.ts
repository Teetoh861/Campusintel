// components/landing/fonts.ts — The landing display typeface, self-hosted by next/font. Body text uses the app's own
// Hanken Grotesk from the root layout, so the page loads two font files: this one and the app's.
import { Playfair_Display } from 'next/font/google'

export const landingDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['700', '800'],
  display: 'swap',
  variable: '--landing-display',
})
