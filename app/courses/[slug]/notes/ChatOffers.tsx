// app/courses/[slug]/notes/ChatOffers.tsx — The buttons under Campus Bot's newest turn in Ask Campus Bot (owner
// decisions B5 and B6, mock 8): Explain again, Make flashcards and Quiz me on this topic, as pills that wrap on a phone.
// Which show is decided here; what each does is the chat's (AskCampusBot).
import { btnGhost } from '@/components/chrome/ui'
import { studentAction } from '@/components/student/ui'
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import { isLeadIn } from '@/lib/campus-bot/reply-text'
import type { ChatAction } from '@/lib/campus-bot/contract'
import type { ReactElement } from 'react'
import type { Turn } from './AskCampusBot'

export type ChatOffersAllowed = { flashcards: boolean; quiz: boolean }
/** A button under Campus Bot's newest turn. */
export type ChatOffer = ChatAction | 'quiz'

const OFFER_LABEL: Record<ChatOffer, string> = { 'explain-again': CAMPUS_BOT_COPY.explainAgain,
  flashcards: CAMPUS_BOT_COPY.makeFlashcards, quiz: CAMPUS_BOT_COPY.quiz.start }

/**
 * The buttons under the newest turn: in an empty chat, Make flashcards then Quiz me on this topic; after a Campus Bot
 * reply, Explain again first, unless the reply only introduces its Quick check; after flashcards, Quiz me alone. None
 * under a student's turn, none the topic does not offer, and none while something is being written or a notice shows
 * (`busy`).
 */
export function chatOffers(turns: ReadonlyArray<Turn>, allowed: ChatOffersAllowed, busy = false): ChatOffer[] {
  if (busy) return []
  const latest = turns.at(-1)
  const list: ChatOffer[] = latest === undefined ? ['flashcards', 'quiz']
    : latest.role !== 'bot' ? []
      : latest.cards ? ['quiz']
        : [...(isLeadIn(latest.text) ? [] : ['explain-again' as const]), 'flashcards', 'quiz']
  return list.filter(offer => offer === 'explain-again' || allowed[offer])
}

/** The buttons under the newest turn, as mock 8's pills; they wrap on a phone. */
export function ChatOffers({ offers, onPick }: { offers: ReadonlyArray<ChatOffer>; onPick: (offer: ChatOffer) => void }):
  ReactElement | null {
  if (offers.length === 0) return null
  return <div className="student-ask-offers">
    {offers.map(offer => <button key={offer} type="button"
      className={studentAction(btnGhost, 'bg-student-surface', 'student-ask-pill')} onClick={() => onPick(offer)}>
      {OFFER_LABEL[offer]}</button>)}
  </div>
}
