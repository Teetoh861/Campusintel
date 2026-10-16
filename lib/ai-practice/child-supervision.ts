// lib/ai-practice/child-supervision.ts — Tracks a child process until its death is confirmed and signals it in a way
// that can never throw, so a broken signal path degrades into a held slot instead of a crashed server.
import 'server-only'
import type { ChildProcess } from 'node:child_process'

// SIGKILL is re-sent at this interval until the process is confirmed dead.
const KILL_RETRY_MS = 250
// A process asked to stop gracefully gets this long before the first SIGKILL.
const GRACEFUL_STOP_MS = 250

export const errorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'unknown error'

/** True only when the kernel reports the process absent; a process this one may not signal still exists. */
export function processGone(pid: number): boolean {
  try { process.kill(pid, 0); return false } catch (error) { return errorCode(error) === 'ESRCH' }
}

/** A child process watched until exit, close or ESRCH confirms that it is dead. */
export type Supervised = {
  readonly child: ChildProcess
  readonly dead: Promise<void>
  isDead(): boolean
  /** Signal until confirmed dead: SIGTERM first when graceful, then SIGKILL on every retry. Idempotent. */
  terminate(graceful: boolean): Promise<void>
}

/**
 * Supervise `child`, which joins `registry` until it is confirmed dead. Call this straight after spawning,
 * before anything can signal the child, so that every error it emits is heard.
 */
export function supervise(child: ChildProcess, label: string, registry: Set<ChildProcess>): Supervised {
  let dead = false
  let markDead = () => {}
  const deadPromise = new Promise<void>(done => {
    markDead = () => { if (!dead) { dead = true; registry.delete(child); done() } }
  })
  registry.add(child)
  child.once('exit', () => markDead())
  child.once('close', () => markDead())
  let signalFailureReported = false
  // 'on', not 'once': every failed signal may emit 'error', and an unheard one would crash the server.
  child.on('error', error => {
    // A retried kill fails the same way every time; one report per process is enough.
    const failedSignal = 'syscall' in error && error.syscall === 'kill'
    if (!failedSignal || !signalFailureReported) console.error(`AI practice ${label} failed`, error.message)
    if (failedSignal) signalFailureReported = true
    if (child.pid === undefined) markDead()
  })
  // Node assigns a pid synchronously on a successful spawn; without one, no process ever existed.
  if (child.pid === undefined) markDead()

  const signal = (name: NodeJS.Signals) => {
    if (dead) return
    try { child.kill(name) } catch (error) {
      // ChildProcess.kill throws on EINVAL and ENOSYS; other failures arrive as 'error' events.
      if (!signalFailureReported) console.error(`AI practice ${label} could not be signalled`, errorMessage(error))
      signalFailureReported = true
    }
    // Independent evidence of death: the kernel no longer knows the process.
    if (child.pid !== undefined && processGone(child.pid)) markDead()
  }
  let terminating = false
  const terminate = (graceful: boolean) => {
    if (dead || terminating) return deadPromise
    terminating = true
    // Armed before the first signal, so no failure of that signal can skip the retries.
    let retry: NodeJS.Timeout | undefined
    const escalate = setTimeout(() => {
      retry = setInterval(() => signal('SIGKILL'), KILL_RETRY_MS)
      retry.unref()
      signal('SIGKILL')
    }, graceful ? GRACEFUL_STOP_MS : KILL_RETRY_MS)
    escalate.unref()
    void deadPromise.then(() => { clearTimeout(escalate); clearInterval(retry) })
    signal(graceful ? 'SIGTERM' : 'SIGKILL')
    return deadPromise
  }
  return { child, dead: deadPromise, isDead: () => dead, terminate }
}

/** SIGKILL every process in the registries without throwing; for the server's own exit. */
export function killAll(...registries: Set<ChildProcess>[]): void {
  for (const registry of registries) {
    for (const child of registry) {
      try { child.kill('SIGKILL') } catch { /* The server is exiting; nothing is left to report to. */ }
    }
  }
}
