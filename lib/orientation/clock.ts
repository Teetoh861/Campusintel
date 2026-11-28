/** Conservative shared deadline: charge the complete request round trip to the phone. */
export function quizRemaining(serverNow: string, deadline: string, sentAt: number, monotonicNow: number): number {
  return Math.max(0,Date.parse(deadline) - Date.parse(serverNow) - Math.max(0,monotonicNow - sentAt))
}
/** A zero-based option always carries its letter as well as its text. */
export function optionLetter(index: number): string { return String.fromCharCode(65 + index) }
