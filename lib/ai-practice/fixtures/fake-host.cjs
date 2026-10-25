// lib/ai-practice/fixtures/fake-host.cjs — A fake clock and fake parser and ps processes for parser-process.ts, so its
// deadline, sampling, queue, kill and crash decisions are tested by stepping time instead of waiting for it.
// The clock follows Node's loop order at each instant: due timers, then I/O (exit, message), then setImmediate.
const childProcess = require('node:child_process')
const { EventEmitter } = require('node:events')
const { mock } = require('node:test')
const memorySampler = require('../memory-sampler.ts')

const realSetImmediate = setImmediate
const TIMER_APIS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate']
// Far above any real pid, so a fake process is never confused with one.
const FIRST_FAKE_PID = 4_000_000

/** Let every promise continuation that is already possible run, as it would before the loop moves on. */
const settle = () => new Promise(resolve => realSetImmediate(resolve))

class FakeClock {
  constructor() {
    this.now = 0
    this.sequence = 0
    this.timers = new Map()
    this.io = []
    this.immediates = []
  }

  install() {
    this.saved = Object.fromEntries(TIMER_APIS.map(name => [name, globalThis[name]]))
    this.savedNow = Date.now
    const handle = timer => Object.assign(timer, {
      ref() { return this }, unref() { return this }, hasRef: () => true, [Symbol.toPrimitive]: () => timer.id,
    })
    const arm = (fn, ms, args, repeat) => {
      const id = ++this.sequence
      const delay = Math.max(1, Number(ms) || 0)
      const timer = handle({ id, at: this.now + delay, delay, fn, args, repeat })
      this.timers.set(id, timer)
      return timer
    }
    const clear = timer => { if (timer != null) this.timers.delete(typeof timer === 'object' ? timer.id : Number(timer)) }
    globalThis.setTimeout = (fn, ms, ...args) => arm(fn, ms, args, false)
    globalThis.setInterval = (fn, ms, ...args) => arm(fn, ms, args, true)
    globalThis.clearTimeout = clear
    globalThis.clearInterval = clear
    globalThis.setImmediate = (fn, ...args) => {
      const immediate = { fn, args, cleared: false }
      this.immediates.push(immediate)
      return immediate
    }
    globalThis.clearImmediate = immediate => { if (immediate) immediate.cleared = true }
    Date.now = () => this.now
  }

  uninstall() {
    Object.assign(globalThis, this.saved)
    Date.now = this.savedNow
  }

  /** Queue an I/O callback (an exit or a message) for the poll phase `afterMs` from now. */
  deliver(fn, afterMs = 0) {
    this.io.push({ at: this.now + afterMs, sequence: ++this.sequence, fn })
  }

  /** One loop iteration at the current instant; true when anything ran. */
  async iterate() {
    let ran = false
    const due = [...this.timers.values()].filter(timer => timer.at <= this.now).sort((a, b) => a.at - b.at || a.id - b.id)
    for (const timer of due) {
      if (!this.timers.has(timer.id)) continue
      if (timer.repeat) timer.at = this.now + timer.delay
      else this.timers.delete(timer.id)
      timer.fn(...timer.args)
      ran = true
      await settle()
    }
    const io = this.io.filter(event => event.at <= this.now).sort((a, b) => a.at - b.at || a.sequence - b.sequence)
    this.io = this.io.filter(event => !io.includes(event))
    for (const event of io) { event.fn(); ran = true; await settle() }
    const immediates = this.immediates.splice(0)
    for (const immediate of immediates) {
      if (immediate.cleared) continue
      immediate.fn(...immediate.args)
      ran = true
      await settle()
    }
    return ran
  }

  /** Move time forward by `ms`, running everything that falls due on the way, in order. */
  async advance(ms) {
    const target = this.now + ms
    await settle()
    for (;;) {
      if (await this.iterate()) continue
      const next = Math.min(...[...this.timers.values()].map(timer => timer.at), ...this.io.map(event => event.at))
      if (!(next <= target)) break
      this.now = next
    }
    this.now = target
    await settle()
  }
}

/** A process as ChildProcess presents it: kill() asks it to die, and its exit arrives as I/O. */
class FakeProcess extends EventEmitter {
  constructor(host, spawnfile, { pid = host.nextPid++, onKill = 'die', exitDelayMs = 0 } = {}) {
    super()
    this.host = host
    this.spawnfile = spawnfile
    this.pid = pid
    this.onKill = onKill
    this.exitDelayMs = exitDelayMs
    // alive, then exited (a zombie the kernel still knows), then reaped when the exit event is delivered.
    this.state = pid === undefined ? 'never' : 'alive'
    this.signals = []
    this.messages = []
    this.stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
    if (pid !== undefined) host.processes.set(pid, this)
  }

  kill(signal = 'SIGTERM') {
    this.signals.push(signal)
    if (typeof this.onKill === 'function') return this.onKill.call(this, signal)
    if (this.onKill === 'ignore' || (this.onKill === 'ignore-term' && signal === 'SIGTERM')) return false
    this.exit({ signal })
    return true
  }

  /** The process ends now; the parent hears of it `exitDelayMs` later, as Node does after reaping it. */
  exit({ code = null, signal = null, stderr = '' } = {}) {
    if (this.state !== 'alive') return
    this.state = 'exited'
    if (stderr) this.host.clock.deliver(() => this.stderr.emit('data', stderr))
    this.host.clock.deliver(() => {
      this.state = 'reaped'
      this.emit('exit', code, signal)
      this.emit('close', code, signal)
    }, this.exitDelayMs)
  }

  send(message, callback) {
    this.messages.push(message)
    const error = this.host.sendError
    this.host.clock.deliver(() => callback?.(error ?? null))
    return true
  }

  /** The parser's one answer. */
  answer(message) { this.host.clock.deliver(() => this.emit('message', message)) }
}

/** One memory reading the test settles by hand. */
function pendingSample(sampler = null) {
  const sample = { sampler, outcome: 'pending' }
  sample.bytes = new Promise((resolve, reject) => {
    sample.resolve = value => { sample.outcome = 'resolved'; resolve(value) }
    sample.reject = error => { sample.outcome = 'rejected'; reject(error) }
  })
  // The production code always attaches handlers; this keeps an unobserved test sample from being reported.
  sample.bytes.catch(() => {})
  return sample
}

/**
 * Replace the clock, fork, the memory sampler and process.kill for parser-process.ts. `parser` and `sample`
 * decide what each spawned parser and each started sample does; both default to a well-behaved host.
 */
function installFakeHost({ parser = () => ({}), sample = () => pendingSample() } = {}) {
  const host = { clock: new FakeClock(), processes: new Map(), parsers: [], samples: [], nextPid: FIRST_FAKE_PID,
    sendError: null, errors: [] }
  host.clock.install()
  // The pool's diagnostics are collected for assertions instead of printed.
  mock.method(console, 'error', (...args) => { host.errors.push(args.join(' ')) })
  const realKill = process.kill
  mock.method(childProcess, 'fork', file => {
    const options = parser(host.parsers.length)
    if (options.throws) throw options.throws
    const child = new FakeProcess(host, file, options)
    host.parsers.push(child)
    if (child.pid === undefined) host.clock.deliver(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })))
    return child
  })
  mock.method(memorySampler, 'startSample', pid => {
    const next = sample(host.samples.length, pid)
    host.samples.push(next)
    return next
  })
  mock.method(process, 'kill', (pid, signal) => {
    const fake = host.processes.get(pid)
    if (fake === undefined) return realKill.call(process, pid, signal)
    if (fake.state === 'reaped') throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH', syscall: 'kill' })
    return true
  })
  host.spawnPs = options => new FakeProcess(host, 'ps', options)
  host.uninstall = () => {
    mock.restoreAll()
    host.clock.uninstall()
  }
  return host
}

module.exports = { installFakeHost, pendingSample }
