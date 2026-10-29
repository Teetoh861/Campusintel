// components/landing/MobileMenu.tsx — Below desktop, the landing links and account entry in one disclosure.
'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { btnBase, btnGhost, btnNavy, btnSm, buttonClassName } from '@/components/chrome/ui'
import styles from './landing.module.css'
import type { TextLink } from '@/lib/landing/content'
import type { ReactElement } from 'react'

const DESKTOP_QUERY = '(min-width: 1200px)'

type Props = { links: TextLink[]; login: TextLink; register: TextLink; label: string; openLabel: string; closeLabel: string }

/** Escape and a link choice close the menu; Escape returns focus to the toggle. */
export function MobileMenu({ links, login, register, label, openLabel, closeLabel }: Props): ReactElement {
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const desktop = window.matchMedia(DESKTOP_QUERY)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      toggle.current?.focus()
    }
    const onDesktop = (): void => { if (desktop.matches) setOpen(false) }
    document.addEventListener('keydown', onKey)
    desktop.addEventListener('change', onDesktop)
    return () => {
      document.removeEventListener('keydown', onKey)
      desktop.removeEventListener('change', onDesktop)
    }
  }, [open])

  const close = (): void => setOpen(false)
  return (
    <>
      <button ref={toggle} type="button" aria-expanded={open} aria-controls={panelId} aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen(value => !value)}
        className={buttonClassName(btnBase, btnSm, btnGhost, 'h-11 w-11 px-0 desktop:hidden')}>
        {open ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}
      </button>
      <div id={panelId} hidden={!open} className={styles.menuPanel}>
        <nav aria-label={label} className="app-container">
          <ul className={styles.menuList}>
            {links.map(link => (
              <li key={link.href}>
                <Link href={link.href} prefetch={false} onClick={close}
                  className={buttonClassName(btnBase, btnGhost, 'w-full justify-start border-transparent px-3 text-[16px] text-student-text-primary')}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className={styles.menuActions}>
            <Link href={login.href} prefetch={false} onClick={close} className={buttonClassName(btnBase, btnGhost, 'rounded-full')}>{login.label}</Link>
            <Link href={register.href} prefetch={false} onClick={close} className={buttonClassName(btnBase, btnNavy, 'rounded-full')}>{register.label}</Link>
          </div>
        </nav>
      </div>
    </>
  )
}
