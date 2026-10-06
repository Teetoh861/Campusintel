// app/courses/[slug]/quiz/assessmentClock.ts — Track elapsed assessment time with a one-shot deadline.
type ClockReading = { secondsLeft: number; expiredNow: boolean }

type AssessmentClock = {
  start: (durationSeconds: number) => void
  read: () => ClockReading
  stop: () => void
}

/** Create a wall-clock deadline with an explicit duration for each attempt. */
export function createAssessmentClock(now: () => number = Date.now): AssessmentClock {
  let durationSeconds = 0
  let deadline: number | null = null
  let expiryReported = false

  return {
    start(acceptedDurationSeconds: number): void {
      durationSeconds = acceptedDurationSeconds
      deadline = now() + durationSeconds * 1000
      expiryReported = false
    },
    read(): ClockReading {
      if (deadline === null) return { secondsLeft: durationSeconds, expiredNow: false }
      const secondsLeft = Math.max(0, Math.ceil((deadline - now()) / 1000))
      const expiredNow = secondsLeft === 0 && !expiryReported
      if (expiredNow) expiryReported = true
      return { secondsLeft, expiredNow }
    },
    stop(): void {
      deadline = null
      expiryReported = false
    },
  }
}
