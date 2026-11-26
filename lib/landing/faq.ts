// lib/landing/faq.ts — A landing FAQ item, and the answer it gives at a moment. Kept apart from the page's words so the
// FAQ list, which runs in the browser, loads only this.

/** `later` replaces `answer` from its instant on: the page is built once, so an answer that changes on a date carries
 *  both (components/landing/FaqList.tsx picks again on the visitor's device). */
export type FaqItem = { question: string; answer: string; later?: { from: string; answer: string } }

/** The answer an item gives at `now` (milliseconds since 1970). */
export function faqAnswer(item: FaqItem, now: number): string {
  return item.later !== undefined && now >= Date.parse(item.later.from) ? item.later.answer : item.answer
}
