// components/student/CBrandTexture.tsx — One restrained pattern using the owner's supplied C artwork.
import type { ReactElement } from 'react'

/** Decorative C texture: never content, interaction or a second source of brand geometry. */
export function CBrandTexture({ tone = 'light' }: { tone?: 'light' | 'navy' }): ReactElement {
  return <span aria-hidden="true" className="student-c-texture" data-tone={tone} />
}
