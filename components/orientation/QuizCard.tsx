import { QuizCardClient } from './QuizCardClient'

/** The gated Dashboard mounts a hidden card until one authenticated poll establishes an active event. */
export function QuizCard() { return <QuizCardClient initial={null} /> }
