// app/courses/[slug]/quiz/practice-storage.ts — What one browser keeps for practice: never the authority.
// The server holds the attempt, its deadline, its saved sheet and its grade. This device keeps only conveniences and
// safety nets, each validated on read and written inside try/catch (storage can be missing, full or blocked):
//   * flags (D2), per attempt, in local storage, so they survive reload, Exit and resume on this device;
//   * a start in flight, per course, in session storage, so a lost start response is recovered by asking for the same
//     attempt id again instead of starting another;
//   * this tab's unsent choices, per attempt, in session storage, so a reload sends them instead of losing them;
//   * an instant-feedback pick the server has not answered yet, per attempt, in session storage, so it is sent again on
//     reconnect or reload (a pick is idempotent: resending can only return the result it already has).
import { z } from 'zod'
import { sampleAnswers } from '@/lib/entitlements/discovery-contract'
import { practiceTopic } from '@/lib/practice/contract'
import type { UnsentSheet } from '@/lib/entitlements/exam-autosave'
import type { PracticeBrief } from './types'

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

function local(): Store | null { try { return window.localStorage } catch { return null } }
function session(): Store | null { try { return window.sessionStorage } catch { return null } }

function read<T>(store: Store | null, key: string, schema: z.ZodType<T>): T | null {
  if (store === null) return null
  try {
    const parsed = schema.safeParse(JSON.parse(store.getItem(key) ?? 'null'))
    return parsed.success ? parsed.data : null
  } catch { return null }
}

function write(store: Store | null, key: string, value: unknown): boolean {
  if (store === null) return false
  try {
    const serialized = JSON.stringify(value)
    store.setItem(key, serialized)
    return store.getItem(key) === serialized
  } catch { return false }
}

function remove(store: Store | null, key: string): void {
  try { store?.removeItem(key) } catch { /* Nothing to clear. */ }
}

const uuid = z.string().uuid()
const MAX_QUESTIONS = 100

// Flags: the question ids this device flagged in one attempt.
const flagsKey = (attemptId: string) => `practice-flags:${attemptId}`
const flagList = z.array(uuid).max(MAX_QUESTIONS)

export function readFlags(attemptId: string, questionIds: ReadonlyArray<string>): Set<string> {
  const known = new Set(questionIds)
  return new Set((read(local(), flagsKey(attemptId), flagList) ?? []).filter(id => known.has(id)))
}

export function writeFlags(attemptId: string, flags: ReadonlySet<string>): void {
  if (flags.size === 0) remove(local(), flagsKey(attemptId))
  else write(local(), flagsKey(attemptId), [...flags])
}

// A start in flight: retried with the same attempt id until the server answers, even across a reload. An exam start
// carries the brief the student confirmed; an instant one carries its topic.
export type PendingStart = { attemptId: string; intent: 'new' | 'redo'; redoOf: string | null; expected: PracticeBrief & { wholeBank: boolean } }
  | { attemptId: string; mode: 'instant'; topic: string }
const pendingKey = (courseSlug: string) => `practice-start:${courseSlug}`
const pendingStart = z.union([z.object({ attemptId: uuid, intent: z.enum(['new', 'redo']), redoOf: uuid.nullable(),
  expected: z.object({ questionCount: z.number().int().min(1).max(MAX_QUESTIONS),
    durationSeconds: z.number().int().positive(), wholeBank: z.boolean() }).strict() }).strict(),
  z.object({ attemptId: uuid, mode: z.literal('instant'), topic: practiceTopic }).strict()])

export function readPendingStart(courseSlug: string): PendingStart | null {
  return read(session(), pendingKey(courseSlug), pendingStart)
}
export function writePendingStart(courseSlug: string, start: PendingStart): void { write(session(), pendingKey(courseSlug), start) }
export function clearPendingStart(courseSlug: string): void { remove(session(), pendingKey(courseSlug)) }

// This tab's unsent choices for one attempt, re-validated against the attempt's questions on every read.
const unsentKey = (attemptId: string) => `practice-unsent:${attemptId}`
const storedSheet = z.object({ answers: sampleAnswers, dirty: z.array(uuid).max(MAX_QUESTIONS) }).strict()

export function readUnsent(attemptId: string, options: ReadonlyMap<string, number>): UnsentSheet | null {
  const stored = read(session(), unsentKey(attemptId), storedSheet)
  if (stored === null) return null
  const answers = Object.fromEntries(Object.entries(stored.answers)
    .filter(([id, index]) => index < (options.get(id) ?? 0)))
  return { answers, dirty: stored.dirty.filter(id => options.has(id)) }
}
/** True only when this exact pending sheet can be read back from this device. */
export function writeUnsent(attemptId: string, sheet: UnsentSheet): boolean { return write(session(), unsentKey(attemptId), sheet) }
export function clearUnsent(attemptId: string): void { remove(session(), unsentKey(attemptId)) }

// An instant pick sent but not yet answered: one at a time, since the next question waits for this one's result.
export type PendingPick = { questionId: string; option: number }
const pickKey = (attemptId: string) => `practice-pick:${attemptId}`
const pendingPick = z.object({ questionId: uuid, option: z.number().int().min(0).max(7) }).strict()

export function readPendingPick(attemptId: string): PendingPick | null { return read(session(), pickKey(attemptId), pendingPick) }
export function writePendingPick(attemptId: string, pick: PendingPick): void { write(session(), pickKey(attemptId), pick) }
export function clearPendingPick(attemptId: string): void { remove(session(), pickKey(attemptId)) }

// Results this device has shown, so a course page visit shows a result the student has not seen yet (time ran out
// while away, or a submission's response was lost) exactly once, and the briefing afterwards.
const seenKey = (attemptId: string) => `practice-seen:${attemptId}`
export function resultSeen(attemptId: string): boolean { return read(local(), seenKey(attemptId), z.literal(true)) === true }
export function markResultSeen(attemptId: string): void { write(local(), seenKey(attemptId), true) }
