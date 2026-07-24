'use client'

import { useState, type ReactNode } from 'react'
import { cx } from '@/components/chrome/ui'

export type CourseAccordionSection = {
  id: string
  label: string
  content: ReactNode
}

export function CourseAccordion({
  sections,
}: {
  sections: ReadonlyArray<CourseAccordionSection>
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())

  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, index) => {
        const isOpen = openIds.has(section.id)
        const buttonId = `accordion-button-${section.id}`
        const panelId = `accordion-panel-${section.id}`

        return (
          <section
            key={section.id}
            id={section.id}
            className="scroll-mt-[96px] overflow-hidden rounded-[16px] border border-ci-border bg-ci-white shadow-ci-card"
            data-screen-label={section.label}
          >
            <button
              id={buttonId}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(section.id)}
              className={cx(
                'flex min-h-16 w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-ci-paper-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ci-accent min-[680px]:px-7 min-[680px]:py-5',
                isOpen && 'border-b border-ci-border',
              )}
            >
              <span className="flex min-w-0 items-baseline gap-3">
                <span className="flex-none text-[12px] font-bold tracking-[0.08em] text-ci-accent-600 [font-variant-numeric:tabular-nums]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 text-[17px] font-bold leading-snug text-ci-navy-900 min-[680px]:text-[18px]">
                  {section.label}
                </span>
              </span>
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className={cx(
                  'h-5 w-5 flex-none text-ci-navy transition-transform duration-200',
                  isOpen && 'rotate-180',
                )}
              >
                <path
                  d="m5 7.5 5 5 5-5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!isOpen}
              className="px-5 pb-6 pt-5 min-[680px]:px-7 min-[680px]:pb-7 min-[680px]:pt-6"
            >
              {section.content}
            </div>
          </section>
        )
      })}
    </div>
  )
}
