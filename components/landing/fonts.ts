// components/landing/fonts.ts — Landing-only typefaces, self-hosted by next/font; the app keeps Hanken Grotesk.
import { Playfair_Display, Source_Sans_3 } from 'next/font/google'

export const landingDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--landing-display',
})

export const landingBody = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--landing-body',
})
