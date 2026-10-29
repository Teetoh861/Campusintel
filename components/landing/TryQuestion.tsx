// components/landing/TryQuestion.tsx — "Try a real question" section; the questions ship in the page, nothing is fetched.
import { landingContent } from '@/lib/landing/content'
import { TryQuestionQuiz } from './TryQuestionQuiz'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { tryQuestion, images } = landingContent
const { questions, ...copy } = tryQuestion

export function TryQuestion(): ReactElement {
  const intro = (
    <>
      <span className={styles.eyebrow}>{copy.eyebrow}</span>
      <h2 id="try-title" className="mt-3">{copy.title}</h2>
      <p className={styles.otherText}>{copy.text}</p>
    </>
  )
  return (
    <section id={copy.id} className={`${styles.sec} ${styles.quizSec} ${styles.anchor}`} aria-labelledby="try-title">
      <div className={`app-container ${styles.quizGrid}`}>
        <TryQuestionQuiz copy={copy} questions={questions} intro={intro} botSrc={images.campusBot.src} />
      </div>
    </section>
  )
}
