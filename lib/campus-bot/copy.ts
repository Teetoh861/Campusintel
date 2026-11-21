// lib/campus-bot/copy.ts — Every line a student reads in Explain, Ask Campus Bot and Quiz me on this topic (owner-approved, 16 November 2026;
// docs/student-copy.md). Output is labelled Campus Bot. The lines for a student without Campus Bot and for a limit are
// kept here, with the wording approved for these two features, until the Campus Bot page's own lines match them.
import { accessCopy, formatAccessTime, formatAccessWeekday } from '@/lib/entitlements/presentation'

export const CAMPUS_BOT_COPY = {
  name: 'Campus Bot',

  // Explain.
  explain: 'Explain',
  explaining: 'Campus Bot is explaining…',
  fromNotes: 'From your notes:',
  notCovered: 'The notes for this course don’t cover this question.',
  /** A calculation course's explanation that did not pass its check: where the question is taught. */
  checkFailed: (topic: string) => `This question is from ${topic}.`,
  openNotes: 'Open notes',
  explainFailed: 'Campus Bot couldn’t explain this. Try again.',

  // Ask Campus Bot: its button in a topic's Campus Bot area, then the chat.
  ask: 'Ask a question',
  askPlaceholder: (topic: string) => `Ask about ${topic}`,
  send: 'Send',
  close: 'Close',
  answering: 'Campus Bot is answering…',
  you: 'You',
  outsideNotes: 'This isn’t covered in this topic’s notes.',
  askFailed: 'Campus Bot couldn’t answer that. Try again.',

  // Quiz me on this topic: its button in a topic's Campus Bot area, the wait, then the set on its own page (owner
  // decisions of 16 November 2026).
  quiz: {
    start: 'Quiz me on this topic',
    writing: 'Campus Bot is writing your questions…',
    /** A free pass's sets left, before any is used: the one line about the pass the quiz shows. */
    passLeft: (left: number, total: number) =>
      `${left} of ${total} Campus Bot ${total === 1 ? 'set' : 'sets'} left on your free pass.`,
    failed: 'We couldn’t create your questions.',
    /** The one label a set written from a notes topic carries (docs/student-copy.md rule 6). */
    label: 'Made by Campus Bot from this topic’s notes.',
    fromNotes: 'From the notes:',
    backToTopic: 'Back to topic',
    /** The set's heading for screen readers; the page's title already names the topic. */
    heading: 'Quiz',
  },

  // All three.
  tryAgain: 'Try again',
  busyTitle: 'Campus Bot is busy.',
  busyLine: 'Try again in a few minutes.',
  examOpen: 'Campus Bot is available when your exam ends.',
  noConnection: 'No connection.',
  signedOut: 'You’ve been signed out.',
  signIn: 'Sign in',
  reload: 'Reload',

  /** A student without Campus Bot: one line and the one place it opens. */
  notice: {
    subscribe: accessCopy(true).aiNotEntitled,
    'free-pass': 'Campus Bot opens with a free pass.',
    plan: 'Campus Bot is included with a plan.',
  },

  limits: {
    session: { title: 'You’ve used up Campus Bot for now.',
      line: (iso: string | null) => iso ? `It resets at ${formatAccessTime(iso)}.` : '' },
    week: { title: 'You’ve used up Campus Bot for this week.',
      line: (iso: string | null) => iso ? `It resets ${formatAccessWeekday(iso)} at ${formatAccessTime(iso)}.` : '' },
    passExplain: 'You’ve used your free pass explanations.',
    passChat: 'You’ve used your free pass messages.',
    passQuiz: 'You’ve used your free pass Campus Bot set.',
    undelivered: { title: 'Campus Bot limit reached.', line: 'Try again tomorrow.' },
  },
} as const
