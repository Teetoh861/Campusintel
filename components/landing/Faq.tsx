// components/landing/Faq.tsx — Common questions plus the Instagram and email help route.
import Image from 'next/image'
import { CONTACT_EMAIL, INSTAGRAM_URL } from '@/lib/contact'
import { landingContent } from '@/lib/landing/content'
import { FaqList } from './FaqList'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { faq, images } = landingContent
const INLINE_LINK = 'student-link font-bold'

export function Faq(): ReactElement {
  return (
    <section id={faq.id} className={`${styles.sec} ${styles.secTight} ${styles.anchor}`} aria-labelledby="faq-title">
      <div className={`app-container ${styles.faqGrid}`}>
        <div>
          <span className={styles.eyebrow}>{faq.eyebrow}</span>
          <h2 id="faq-title" className="mt-3">{faq.title}</h2>
          <div className={styles.help}>
            <Image src={images.campusBot.src} width={images.campusBot.width} height={images.campusBot.height} alt=""
              sizes="64px" className={styles.helpBot} />
            <p>
              {faq.helpLead}{' '}
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>
                {faq.helpInstagram}<span className="sr-only"> {landingContent.newTab}</span>
              </a>{' '}
              {faq.helpJoin}{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className={`${INLINE_LINK} [overflow-wrap:anywhere]`}>{CONTACT_EMAIL}</a>.
            </p>
          </div>
        </div>
        <FaqList items={faq.items} />
      </div>
    </section>
  )
}
