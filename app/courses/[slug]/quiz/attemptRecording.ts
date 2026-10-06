import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import type { ManagedQuizQuestion } from '@/lib/managed-content/student-projection'

export type RecordingStatus = 'checking' | 'recording' | 'saved' | 'signed-out' | 'session-changed' | 'content-changed' | 'unavailable'
type Completion = 'submitted' | 'timed_out'
type Answer = { questionId: string; ordinal: number; optionIndex: number }
type WriteResult = 'saved' | 'session-changed' | 'content-changed' | 'unavailable'

type Attempt = {
  id: string
  courseContentKey: string
  questions: ReadonlyArray<ManagedQuizQuestion>
  desired: Map<number, Answer>
  persisted: Map<number, number>
  revision: number
  readonly token: string
  status: RecordingStatus
  finishRequested: Completion | null
  draining: boolean
}

type QuizAttemptRecorder = {
  begin: (courseContentKey: string, questions: ReadonlyArray<ManagedQuizQuestion>) => string
  select: (ordinal: number, optionIndex: number) => void
  finish: (completion: Completion) => void
}

const ENDPOINT = '/api/quiz-attempts'
const REQUEST_TIMEOUT_MS = 6000
const MAX_REQUESTS = 3
const RETRY_DELAY_MS = 150

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validSave(body: unknown, attempt: Attempt, revision: number, status: string): boolean {
  if (!isObject(body) || body.status !== 'saved' || !isObject(body.attempt)) return false
  return body.attempt.id === attempt.id && body.attempt.revision === revision &&
    body.attempt.status === status && body.attempt.questionCount === attempt.questions.length
}

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

/** Send only question identity and the chosen option; the server owns identity and correctness. */
export function createQuizAttemptRecorder(
  pageToken: string,
  onStatus: (status: RecordingStatus) => void,
  request: typeof fetch = fetch,
  makeId: () => string = () => crypto.randomUUID(),
): QuizAttemptRecorder {
  let current: Attempt | null = null

  function setStatus(attempt: Attempt, status: RecordingStatus): void {
    attempt.status = status
    if (current === attempt) onStatus(status)
  }

  async function write(attempt: Attempt, command: Record<string, unknown>, revision: number,
    status: 'in_progress' | Completion): Promise<WriteResult> {
    const body = JSON.stringify(command)
    for (let number = 0; number < MAX_REQUESTS; number += 1) {
      try {
        const response = await request(ENDPOINT, {
          method: 'POST', cache: 'no-store', credentials: 'same-origin',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: attempt.token },
          body,
        })
        const result: unknown = await response.json()
        if (response.ok && validSave(result, attempt, revision, status)) return 'saved'
        if (isObject(result) && (result.status === 'signed-out' || result.status === 'session-changed')) {
          return 'session-changed'
        }
        if (isObject(result) && result.status === 'conflict' && command.operation === 'start') {
          return 'content-changed'
        }
        if (response.status !== 503) return 'unavailable'
      } catch {
        // Reuse the exact command, revision, and attempt ID after an uncertain response.
      }
      if (number < MAX_REQUESTS - 1) await pause(RETRY_DELAY_MS * (number + 1))
    }
    return 'unavailable'
  }

  function changes(attempt: Attempt): Answer[] {
    return [...attempt.desired.values()].filter(answer =>
      attempt.persisted.get(answer.ordinal) !== answer.optionIndex)
  }

  function drain(attempt: Attempt): void {
    if (attempt.draining || !['checking', 'recording'].includes(attempt.status)) return
    attempt.draining = true
    void (async () => {
      try {
        if (attempt.status === 'checking') {
          const started = await write(attempt, {
            operation: 'start', attemptId: attempt.id, courseContentKey: attempt.courseContentKey,
            questions: attempt.questions.map((question, ordinal) => ({
              questionId: question.questionId, ordinal, publishedRevision: question.publishedRevision,
            })),
          }, 0, 'in_progress')
          if (started !== 'saved') {
            setStatus(attempt, started)
            return
          }
          setStatus(attempt, 'recording')
        }

        while (attempt.status === 'recording') {
          if (attempt.finishRequested) {
            const completion = attempt.finishRequested
            const result = await write(attempt, {
              operation: 'finish', attemptId: attempt.id, courseContentKey: attempt.courseContentKey,
              expectedRevision: attempt.revision, completion, answers: [...attempt.desired.values()],
            }, attempt.revision + 1, completion)
            setStatus(attempt, result === 'saved' ? 'saved' : result)
            return
          }
          const patch = changes(attempt)
          if (patch.length === 0) return
          const result = await write(attempt, {
            operation: 'record', attemptId: attempt.id, courseContentKey: attempt.courseContentKey,
            expectedRevision: attempt.revision, answers: patch,
          }, attempt.revision + 1, 'in_progress')
          if (result !== 'saved') {
            setStatus(attempt, result)
            return
          }
          attempt.revision += 1
          for (const answer of patch) attempt.persisted.set(answer.ordinal, answer.optionIndex)
        }
      } catch {
        setStatus(attempt, 'unavailable')
      } finally {
        attempt.draining = false
        if (attempt.status === 'recording' && (attempt.finishRequested || changes(attempt).length > 0)) {
          drain(attempt)
        }
      }
    })()
  }

  return {
    begin(courseContentKey: string, questions: ReadonlyArray<ManagedQuizQuestion>): string {
      // A second Start event for the mounted attempt must not create another row.
      if (current && ['checking', 'recording'].includes(current.status) && current.finishRequested === null) {
        return current.id
      }
      const attempt: Attempt = {
        id: makeId(), courseContentKey, questions, desired: new Map(), persisted: new Map(),
        revision: 0, token: pageToken, status: 'checking', finishRequested: null, draining: false,
      }
      current = attempt
      onStatus('checking')
      drain(attempt)
      return attempt.id
    },
    select(ordinal: number, optionIndex: number): void {
      const attempt = current
      if (!attempt || attempt.finishRequested !== null || ordinal < 0 || ordinal >= attempt.questions.length) return
      attempt.desired.set(ordinal, { questionId: attempt.questions[ordinal]!.questionId, ordinal, optionIndex })
      drain(attempt)
    },
    finish(completion: Completion): void {
      const attempt = current
      if (!attempt || attempt.finishRequested !== null) return
      attempt.finishRequested = completion
      drain(attempt)
    },
  }
}
