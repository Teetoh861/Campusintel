// app/courses/[slug]/notes/ChatFlashcards.tsx — Campus Bot's flashcards turn in Ask Campus Bot (owner decision B5,
// mock 8's shape in CampusIntell tokens): one card at a time as a single button that flips between its term and its
// meaning, then Previous, the card's place and Next. Both sides share one grid cell, so a flip never moves what is
// below; the flip is at most 250 ms, and none when the student prefers reduced motion (styles/campus-bot.css).
'use client'

import { useRef, useState } from 'react'
import { btnGhost } from '@/components/chrome/ui'
import { studentAction } from '@/components/student/ui'
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import type { Flashcard } from '@/lib/campus-bot/contract'
import type { ReactElement, Ref } from 'react'

const COPY = CAMPUS_BOT_COPY.flashcards

/** Which card is on screen and which side of it. */
export type FlashcardsState = { index: number; side: 'term' | 'meaning' }
export type FlashcardsMove = 'flip' | 'previous' | 'next'

/** The next state: a flip turns the card over; Previous and Next stop at the ends and show the new card's term. */
export function flashcardsStep(state: FlashcardsState, move: FlashcardsMove, total: number): FlashcardsState {
  if (move === 'flip') return { ...state, side: state.side === 'term' ? 'meaning' : 'term' }
  const index = Math.min(Math.max(state.index + (move === 'next' ? 1 : -1), 0), Math.max(total - 1, 0))
  return index === state.index ? state : { index, side: 'term' }
}

/** What a screen reader is told after a move: the side now showing, and after Previous or Next the card's place. */
export function flashcardsAnnouncement(cards: ReadonlyArray<Flashcard>, state: FlashcardsState, move: FlashcardsMove):
  string {
  const card = cards[state.index]
  if (card === undefined) return ''
  const side = state.side === 'term' ? `${COPY.term}: ${card.term}` : `${COPY.meaning}: ${card.meaning}`
  return move === 'flip' ? side : `${COPY.position(state.index + 1, cards.length)}. ${side}`
}

/** The turn as it looks for one state. */
export function FlashcardsView({ cards, state, announcement, cardRef, onFlip, onMove }: {
  cards: ReadonlyArray<Flashcard>; state: FlashcardsState; announcement: string; cardRef?: Ref<HTMLButtonElement>
  onFlip: () => void; onMove: (move: 'previous' | 'next') => void
}): ReactElement {
  const card = cards[state.index] ?? cards[0]!
  const last = cards.length - 1
  const nav = studentAction(btnGhost, 'bg-student-surface')
  return <>
    <p className="student-practice-eyebrow student-ask-eyebrow">{COPY.heading}</p>
    <p className="student-ask-text">{COPY.hint}</p>
    <button ref={cardRef} type="button" className="student-flashcard" data-side={state.side}
      onClick={onFlip}>
      {/* A new card starts on its term without turning: its faces are new elements. */}
      <span key={state.index} className="student-flashcard-inner">
        <span className="student-flashcard-face" data-face="term" aria-hidden={state.side !== 'term'}>
          <span className="student-flashcard-eyebrow">{COPY.term}</span>
          <span className="student-flashcard-term">{card.term}</span>
        </span>
        <span className="student-flashcard-face" data-face="meaning" aria-hidden={state.side !== 'meaning'}>
          <span className="student-flashcard-eyebrow">{COPY.meaning}</span>
          <span className="student-flashcard-meaning">{card.meaning}</span>
        </span>
      </span>
    </button>
    <p className="sr-only" aria-live="polite">{announcement}</p>
    <div className="student-flashcards-nav">
      <button type="button" className={nav} disabled={state.index <= 0} onClick={() => onMove('previous')}>
        {COPY.previous}</button>
      <p className="student-flashcards-position">{COPY.position(state.index + 1, cards.length)}</p>
      <button type="button" className={nav} disabled={state.index >= last} onClick={() => onMove('next')}>
        {COPY.next}</button>
    </div>
  </>
}

/** The flashcards turn: its own place in the set, kept while the chat lasts. */
export function ChatFlashcards({ cards }: { cards: ReadonlyArray<Flashcard> }): ReactElement {
  const [state, setState] = useState<FlashcardsState>({ index: 0, side: 'term' })
  const [announcement, setAnnouncement] = useState('')
  const card = useRef<HTMLButtonElement>(null)
  const move = (step: FlashcardsMove): void => {
    const next = flashcardsStep(state, step, cards.length)
    if (next === state) return
    setState(next)
    setAnnouncement(flashcardsAnnouncement(cards, next, step))
    // Previous or Next is disabled at either end: focus goes to the card rather than being lost.
    if (step !== 'flip' && (next.index === 0 || next.index === cards.length - 1)) card.current?.focus()
  }
  return <FlashcardsView cards={cards} state={state} announcement={announcement} cardRef={card}
    onFlip={() => move('flip')} onMove={move} />
}
