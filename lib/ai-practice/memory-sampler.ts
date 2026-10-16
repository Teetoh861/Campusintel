// lib/ai-practice/memory-sampler.ts — Reads a parser's resident memory without trusting a broken monitor: /proc on
// Linux spawns nothing, and the ps used elsewhere is a supervised process that is stopped and reaped like the parser.
import 'server-only'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode, processGone, supervise } from './child-supervision'
import type { Supervised } from './child-supervision'

// /proc reads are cheap and spawn nothing; elsewhere (development machines) each sample spawns ps.
export const MEMORY_SAMPLE_MS = process.platform === 'linux' ? 20 : 50
// A sample still outstanding after this means the budget is no longer enforced, so the parse is stopped.
export const MEMORY_SAMPLE_TIMEOUT_MS = 2_000
// ps prints one number; anything longer is not a resident size.
const PS_OUTPUT_CHARS = 64

/** ps processes still alive; a parser slot is not freed while its sampler is in here. */
export const liveSamplers = new Set<ChildProcess>()

/** How this process observes its parsers. Tests point these at a broken host. */
export const parserProbes: { memorySource: 'proc' | 'ps'; procRoot: string } = {
  memorySource: process.platform === 'linux' ? 'proc' : 'ps',
  procRoot: '/proc',
}

/** One memory reading in flight, and the ps process taking it when there is one. */
export type MemorySample = { bytes: Promise<number | 'gone'>; sampler: Supervised | null }

/**
 * Resident set size from /proc in bytes, or 'gone' once the process has exited. A missing entry alone proves
 * nothing, since /proc may be unmounted or hidden; only the kernel's ESRCH or a zombie state does. Throws for
 * a process that still exists, so a broken monitor is never mistaken for a finished parser.
 */
async function procResidentBytes(pid: number): Promise<number | 'gone'> {
  let status: string
  try { status = await readFile(path.join(parserProbes.procRoot, String(pid), 'status'), 'utf8') } catch (error) {
    if ((errorCode(error) === 'ENOENT' || errorCode(error) === 'ESRCH') && processGone(pid)) return 'gone'
    throw error
  }
  const kilobytes = /^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1]
  if (kilobytes !== undefined) return Number(kilobytes) * 1024
  // A zombie has exited and has no resident memory; anything else without VmRSS is unreadable.
  if (/^State:\s+Z/m.test(status)) return 'gone'
  throw new Error('VmRSS missing from /proc status')
}

/**
 * Resident set size from a supervised ps. A ps that does not answer in time is rejected at once and then
 * stopped, SIGTERM before SIGKILL; whoever owns the sample waits for that death before freeing capacity.
 */
function psResidentBytes(pid: number): MemorySample {
  let child: ChildProcess
  try {
    child = spawn('ps', ['-o', 'rss=', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (error) {
    return { bytes: Promise.reject(error), sampler: null }
  }
  const sampler = supervise(child, 'memory sampler', liveSamplers)
  const bytes = new Promise<number | 'gone'>((resolve, reject) => {
    let stdout = ''
    const timer = setTimeout(() => {
      reject(new Error('ps did not answer in time'))
      void sampler.terminate(true)
    }, MEMORY_SAMPLE_TIMEOUT_MS)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout = (stdout + chunk).slice(0, PS_OUTPUT_CHARS) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      const kilobytes = Number.parseInt(stdout.trim(), 10)
      if (code === 0 && Number.isFinite(kilobytes)) resolve(kilobytes * 1024)
      // ps exits 1 when no process matches; confirm that independently before believing it.
      else if (code === 1 && processGone(pid)) resolve('gone')
      else reject(new Error(code === 0 ? 'ps printed no resident size' : `ps exited with ${code ?? 'a signal'}`))
    })
  })
  return { bytes, sampler }
}

/** Start one reading of `pid`; refused while `maxLiveSamplers` ps processes are still alive. */
export function startSample(pid: number, maxLiveSamplers: number): MemorySample {
  if (parserProbes.memorySource === 'proc') return { bytes: procResidentBytes(pid), sampler: null }
  if (liveSamplers.size >= maxLiveSamplers) {
    return { bytes: Promise.reject(new Error('too many memory samplers are alive')), sampler: null }
  }
  return psResidentBytes(pid)
}

/**
 * Resident bytes of any process, or 'gone', answered once any ps it started is confirmed dead. Refused while
 * another ps sampler is alive.
 */
export async function measureResidentBytes(pid: number): Promise<number | 'gone'> {
  const sample = startSample(pid, 1)
  try { return await sample.bytes } finally { await sample.sampler?.dead }
}
