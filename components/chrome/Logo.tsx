// components/chrome/Logo.tsx — Supplied official C mark and wordmark artwork.
import Image from 'next/image'
import { cx } from './ui'
import type { ReactElement } from 'react'

/** Use the owner's approved C artwork unchanged rather than drawing a replacement. */
export function BrandMark({ size = 34, className }: { size?: number; className?: string }): ReactElement {
  return <Image src="/brand/campusintell-mark.png" width={size} height={size} alt="" className={className} />
}

/** Render the owner's exact wordmark artwork for dark or light chrome. */
export function Wordmark({ tone = 'navy', className }: { tone?: 'white' | 'navy'; className?: string }): ReactElement {
  return <Image src={`/brand/campusintell-wordmark-${tone}.png`} width={859} height={135} alt=""
    className={cx('block h-[18px] w-auto shrink-0 tablet:h-5', className)} />
}
