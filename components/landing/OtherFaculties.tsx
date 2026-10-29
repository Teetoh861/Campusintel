// components/landing/OtherFaculties.tsx — Sign-up and waitlist for students outside Management Sciences.
import Image from 'next/image'
import Link from 'next/link'
import { btnAccent, btnBase, btnNavy, buttonClassName } from '@/components/chrome/ui'
import { landingContent } from '@/lib/landing/content'
import { BrandIcon, LandingIcon } from './icons'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { otherFaculties: other, images } = landingContent
const CTA = 'rounded-full px-[26px] py-[14px] text-[16px] font-bold'

/** Join the waitlist renders only when a WhatsApp number is configured. */
export function OtherFaculties({ waitlistUrl }: { waitlistUrl: string | null }): ReactElement {
  return (
    <section className={`${styles.sec} ${styles.secTight}`} aria-labelledby="other-title">
      <div className="app-container">
        <div className={styles.other}>
          <div>
            <span className={styles.eyebrow}>{other.eyebrow}</span>
            <h2 id="other-title">{other.title}</h2>
            <p className={styles.otherText}>{other.text}</p>
            <div className={styles.ctas}>
              <Link href={other.signUp.href} prefetch={false} className={buttonClassName(btnBase, btnAccent, CTA)}>{other.signUp.label}</Link>
              {waitlistUrl && (
                <a href={waitlistUrl} target="_blank" rel="noopener noreferrer" className={buttonClassName(btnBase, btnNavy, CTA)}>
                  <BrandIcon name="whatsapp" />{other.waitlist}<span className="sr-only"> {landingContent.newTab}</span>
                </a>
              )}
            </div>
          </div>
          <ul className={styles.olist}>
            {other.items.map(item => (
              <li key={item.title}>
                <span className={styles.olistIcon}>
                  {item.icon === 'campus-bot'
                    ? <Image src={images.campusBot.src} width={images.campusBot.width} height={images.campusBot.height} alt=""
                      sizes="30px" className={styles.olistBot} />
                    : <LandingIcon name={item.icon} />}
                </span>
                <div><b>{item.title}</b><span>{item.text}</span></div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
