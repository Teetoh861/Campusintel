// components/landing/FaqList.tsx — FAQ disclosure: each question is a button with aria-expanded.
'use client'

import { useId, useState } from 'react'
import { Plus } from 'lucide-react'
import { btnBase, btnGhost, buttonClassName } from '@/components/chrome/ui'
import styles from './landing.module.css'
import type { FaqItem } from '@/lib/landing/content'
import type { ReactElement } from 'react'

/** The first answer starts open, as designed; any number can be open at once. */
export function FaqList({ items }: { items: FaqItem[] }): ReactElement {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]))
  const baseId = useId()
  const toggle = (index: number): void => setOpen(previous => {
    const next = new Set(previous)
    if (next.has(index)) next.delete(index); else next.add(index)
    return next
  })

  return (
    <div className={styles.faqList}>
      {items.map((item, index) => {
        const expanded = open.has(index)
        const answerId = `${baseId}-answer-${index}`
        return (
          <div key={item.question} className={`${styles.faqItem} ${expanded ? styles.faqItemOpen : ''}`}>
            <h3>
              <button type="button" aria-expanded={expanded} aria-controls={answerId} onClick={() => toggle(index)}
                className={buttonClassName(btnBase, btnGhost, 'w-full justify-between gap-4 border-transparent px-0 py-5 text-left text-[17px] font-bold text-student-primary hover:border-transparent hover:bg-transparent active:bg-transparent')}>
                {item.question}
                <span className={styles.faqSign} aria-hidden="true"><Plus size={18} /></span>
              </button>
            </h3>
            <div id={answerId} hidden={!expanded} className={styles.faqAnswer}>{item.answer}</div>
          </div>
        )
      })}
    </div>
  )
}
