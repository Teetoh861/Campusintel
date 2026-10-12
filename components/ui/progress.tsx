'use client'

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@/lib/utils'

const DEFAULT_MAX = 100

/** One effective maximum: a finite positive number, otherwise the shared default. */
function effectiveMax(max: unknown): number {
  return typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX
}

/** Expose the real progress value to assistive technology, not only the visual indicator. */
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, max, ...props }, ref) => {
  const limit = effectiveMax(max)
  // Indeterminate only when the value itself is absent or not a finite number.
  const current = typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), limit) : null
  const percent = current === null ? 0 : (current / limit) * 100
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={current}
      max={limit}
      className={cn(
        'relative h-4 w-full overflow-hidden rounded-full bg-secondary',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
