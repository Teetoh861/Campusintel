// CourseToc — sticky "On this page" rail for the course-detail body. Client
// island purely for the scrollspy active-marker (presentation only; no data or
// routes). Hidden on mobile (the body collapses to a single column); sticky at
// >=900px. Items + numbering are computed server-side from the visible sections.
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { btnAccent, btnBase, btnSm, cx } from '@/components/chrome/ui'

export type TocItem = { id: string; label: string; num: string }

export function CourseToc({ items, quizHref }: { items: ReadonlyArray<TocItem>; quizHref: string }) {
  const [active, setActive] = useState(items[0]?.id ?? '')

  useEffect(() => {
    const spy = () => {
      const y = window.scrollY + 140
      let current = items[0]?.id ?? ''
      for (const it of items) {
        const el = document.getElementById(it.id)
        if (el && el.offsetTop <= y) current = it.id
      }
      setActive(current)
    }
    spy()
    window.addEventListener('scroll', spy, { passive: true })
    window.addEventListener('resize', spy)
    return () => {
      window.removeEventListener('scroll', spy)
      window.removeEventListener('resize', spy)
    }
  }, [items])

  return (
    <aside
      className="hidden min-[900px]:sticky min-[900px]:top-[96px] min-[900px]:block"
      aria-label="On this page"
    >
      <div className="mb-4 text-[11.5px] font-bold uppercase tracking-[0.16em] text-ci-gray-500">
        On this page
      </div>
      <nav className="flex flex-col gap-[2px] border-l border-ci-border">
        {items.map((it) => {
          const isActive = it.id === active
          return (
            <Link
              key={it.id}
              href={`#${it.id}`}
              aria-current={isActive ? 'true' : undefined}
              className={cx(
                '-ml-px flex items-baseline gap-[10px] border-l-2 py-2 pl-4 text-[14.5px] transition-colors',
                isActive
                  ? 'border-ci-accent font-semibold text-ci-navy'
                  : 'border-transparent font-medium text-ci-gray-600 hover:text-ci-navy',
              )}
            >
              <span
                className={cx(
                  'text-[11.5px] font-bold [font-variant-numeric:tabular-nums]',
                  isActive ? 'text-ci-accent-600' : 'text-ci-gray-400',
                )}
              >
                {it.num}
              </span>
              {it.label}
            </Link>
          )
        })}
      </nav>
      <div className="mt-6">
        <Link className={cx(btnBase, btnSm, btnAccent, 'w-full')} href={quizHref}>
          Start quiz
        </Link>
      </div>
    </aside>
  )
}
