// lib/entitlements/termii.test.cjs — The Termii adapter against a mocked transport: request shape, strict configuration,
// bounded waits and the sent / failed / unknown classification. No request ever leaves the process.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { classifyTermiiResponse, createTermiiProvider, readTermiiConfig, TERMII_TIMEOUT_MS } = require('./termii.ts')
const { readSmsConfig } = require('./sms.ts')
const { executeEntitlementCommand } = require('./service.ts')

const KEY = 'TLtestKey0123456789abcdef'
const ENV = { ENTITLEMENT_SMS_PROVIDER: 'termii', TERMII_API_KEY: KEY, TERMII_BASE_URL: 'https://v3.api.termii.com',
  TERMII_SENDER_ID: 'CampusIntl', NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co' }
const OK_BODY = { code: 'ok', balance: 1047.57, message_id: '3017544054459083819856413', message: 'Successfully Sent',
  user: 'Account', message_id_str: '3017544054459083819856413' }
const TO = '+2348031234567'
const SMS = 'CampusIntell trial code: 042917. It expires in 10 minutes. Never share this code with anyone.'

function transport(reply) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return typeof reply === 'function' ? reply(init) : reply
  }
  return { fn, calls }
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const provider = (fn, overrides = {}) => {
  const config = readTermiiConfig({ ...ENV, ...overrides })
  assert.equal(config.status, 'ok')
  return createTermiiProvider(config.config, fn)
}
const send = (p, to = TO) => p.send(to, SMS, AbortSignal.timeout(10_000))

test('the approved request: HTTPS POST /api/sms/send with key, sender, international number, plain type and DND channel', async () => {
  const t = transport(json(200, OK_BODY))
  assert.equal(await send(provider(t.fn)), 'sent')
  assert.equal(t.calls.length, 1)
  const [{ url, init, body }] = t.calls
  assert.equal(url, 'https://v3.api.termii.com/api/sms/send')
  assert.equal(init.method, 'POST')
  assert.equal(init.redirect, 'error', 'a redirect can never carry the key elsewhere')
  assert.equal(init.headers['Content-Type'], 'application/json')
  assert.deepEqual(body, { api_key: KEY, to: '2348031234567', from: 'CampusIntl', sms: SMS, type: 'plain', channel: 'dnd' })
  assert.ok(init.signal instanceof AbortSignal)
})

test('only a 2xx with a message id and no contrary code counts as sent', async () => {
  for (const [status, body, expected] of [
    [200, OK_BODY, 'sent'],
    [200, { message_id: 'abc' }, 'sent'],
    [200, { message_id_str: 'abc', code: 'ok' }, 'sent'],
    [201, { message_id: 12345 }, 'sent'],
    [200, { code: 'ok', message: 'Successfully Sent' }, 'unknown'],
    [200, { message_id: '', code: 'ok' }, 'unknown'],
    [200, { message_id: 'abc', code: 'error' }, 'unknown'],
    [200, [], 'unknown'],
    [200, 'Successfully Sent', 'unknown'],
  ]) assert.equal(classifyTermiiResponse(status, body), expected, JSON.stringify([status, body]))
})

test('a definite refusal is failed; a server error, timeout status or redirect stays unknown and keeps counting', async () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    assert.equal(await send(provider(transport(json(status, { message: 'refused' })).fn)), 'failed', String(status))
  }
  for (const status of [408, 500, 502, 503, 504, 302]) {
    assert.equal(await send(provider(transport(json(status, { message: 'error' })).fn)), 'unknown', String(status))
  }
})

test('malformed, oversized or unreadable success bodies are unknown, never sent', async () => {
  const replies = [
    new Response('<html>gateway</html>', { status: 200 }),
    new Response('', { status: 200 }),
    new Response(JSON.stringify({ message_id: 'x', padding: 'y'.repeat(9000) }), { status: 200 }),
    new Response(JSON.stringify(OK_BODY), { status: 200, headers: { 'Content-Length': '100000' } }),
  ]
  for (const reply of replies) assert.equal(await send(provider(transport(reply).fn)), 'unknown')
})

test('a network error or a provider that never answers is unknown, within a bounded wait', async () => {
  assert.equal(await send(provider(transport(() => { throw new TypeError('fetch failed') }).fn)), 'unknown')
  const hanging = transport(init => new Promise((_, reject) => {
    // A real pending request holds an open socket that keeps the process alive. The mock holds a timer instead;
    // otherwise Node 22 may drain the event loop (AbortSignal.timeout is unref'd) before the deadline fires.
    const socket = setInterval(() => undefined, 1_000)
    init.signal.addEventListener('abort', () => { clearInterval(socket); reject(init.signal.reason) }, { once: true })
  }))
  const started = Date.now()
  const outcome = await provider(hanging.fn).send(TO, SMS, AbortSignal.timeout(50))
  assert.equal(outcome, 'unknown')
  assert.ok(Date.now() - started < TERMII_TIMEOUT_MS, 'the caller deadline bounds the wait')
})

test('a number that is not a normalized Nigerian mobile is never sent', async () => {
  const t = transport(json(200, OK_BODY))
  for (const to of ['2348031234567', '+15551234567', '+23480312345', '+2348031234567 ', '08031234567']) {
    assert.equal(await send(provider(t.fn), to), 'failed', to)
  }
  assert.equal(t.calls.length, 0)
})

test('configuration is strict and has no defaults: anything missing or invalid disables sending', () => {
  assert.equal(readSmsConfig(ENV, transport(json(200, OK_BODY)).fn).status, 'enabled', 'Termii is approved for production')
  for (const name of ['TERMII_API_KEY', 'TERMII_BASE_URL', 'TERMII_SENDER_ID']) {
    assert.deepEqual(readSmsConfig({ ...ENV, [name]: undefined }), { status: 'disabled', reason: 'missing-setting' }, name)
    assert.deepEqual(readSmsConfig({ ...ENV, [name]: '' }), { status: 'disabled', reason: 'missing-setting' }, name)
  }
  for (const [name, value] of [
    ['TERMII_BASE_URL', 'http://v3.api.termii.com'],
    ['TERMII_BASE_URL', 'https://api.termii.com.attacker.example'],
    ['TERMII_BASE_URL', 'https://attacker.example'],
    ['TERMII_BASE_URL', 'https://evil-termii.com'],
    ['TERMII_BASE_URL', 'https://v3.api.termii.com/api'],
    // Any embedded credential is refused; a username alone is enough to prove it.
    ['TERMII_BASE_URL', 'https://user@v3.api.termii.com'],
    ['TERMII_BASE_URL', 'https://v3.api.termii.com:8443'],
    ['TERMII_BASE_URL', 'https://v3.api.termii.com/?x=1'],
    ['TERMII_BASE_URL', 'not a url'],
    ['TERMII_API_KEY', 'short'],
    ['TERMII_API_KEY', `${KEY} `],
    ['TERMII_API_KEY', `${KEY}\n`],
    ['TERMII_SENDER_ID', 'ab'],
    ['TERMII_SENDER_ID', 'TwelveChars1'],
    ['TERMII_SENDER_ID', 'Campus Intel'],
  ]) assert.deepEqual(readSmsConfig({ ...ENV, [name]: value }), { status: 'disabled', reason: 'invalid-setting' }, `${name}=${value}`)
  assert.equal(readTermiiConfig({ ...ENV, TERMII_BASE_URL: 'https://v3.api.termii.com/' }).config.origin, 'https://v3.api.termii.com')
})

test('nothing is logged: not the key, the number or the code, on any outcome', async () => {
  const logged = []
  const originals = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(name => [name, console[name]]))
  for (const name of Object.keys(originals)) console[name] = (...args) => logged.push(args.join(' '))
  try {
    for (const reply of [json(200, OK_BODY), json(401, { message: 'invalid key' }), json(503, {}),
      () => { throw new Error('socket hang up') }]) await send(provider(transport(reply).fn))
  } finally { Object.assign(console, originals) }
  assert.deepEqual(logged, [])
})

test('through the activation flow, an ambiguous Termii answer is recorded as possibly delivered', async () => {
  const recorded = []
  const problems = []
  const env = {
    phoneKey: 'k'.repeat(48), sms: readSmsConfig(ENV, transport(json(503, {})).fn),
    newChallengeId: () => '11111111-1111-4111-8111-111111111111', newCode: () => '042917', now: () => Date.now(),
    prepare: async () => ({ state: 'ready', user_id: '22222222-2222-4222-8222-222222222222',
      expires_at: new Date(Date.now() + 600_000).toISOString(), resend_at: new Date(Date.now() + 60_000).toISOString() }),
    recordDelivery: async (...args) => { recorded.push(args[2]) },
    verify: async () => null,
    reportProblem: problem => problems.push(problem),
  }
  const result = await executeEntitlementCommand(env, { action: 'send-trial-code', phone: '0803 123 4567' })
  assert.equal(result.status, 'code-sent')
  assert.deepEqual(recorded, ['unknown'], 'it counts against every send limit; only a definite refusal is free')
  env.sms = readSmsConfig(ENV, transport(json(400, { message: 'invalid number' })).fn)
  recorded.length = 0
  assert.equal((await executeEntitlementCommand(env, { action: 'send-trial-code', phone: '0803 123 4567' })).status,
    'delivery-failed')
  assert.deepEqual(recorded, ['failed'])
  assert.deepEqual(problems, ['sms-failed'])
})

// ---------------------------------------------------------------------------------------------------------------------
// Response bodies are read incrementally against an 8 KiB limit and released on every path.
// ---------------------------------------------------------------------------------------------------------------------

const LIMIT = 8 * 1024

/** A response body that records how much was pulled from it and whether it was cancelled. */
function trackedBody({ chunkBytes = 1024, totalBytes = Infinity, chunks = null, cancel, error, stallAfter = Infinity } = {}) {
  const tracker = { pulled: 0, cancelled: false, socketOpen: false }
  let index = 0
  let keepAlive = null
  tracker.stream = new ReadableStream({
    pull(controller) {
      if (chunks !== null) {
        if (index >= chunks.length) { controller.close(); return undefined }
        const next = chunks[index++]
        tracker.pulled += next.byteLength
        controller.enqueue(next)
        return undefined
      }
      if (error && tracker.pulled >= error.after) { controller.error(new Error('connection reset')); return undefined }
      if (tracker.pulled >= stallAfter) {
        // Like a slow network: no more bytes, but the connection (and the process) stays alive.
        tracker.socketOpen = true
        keepAlive ??= setInterval(() => undefined, 1_000)
        return new Promise(() => undefined)
      }
      if (tracker.pulled >= totalBytes) { controller.close(); return undefined }
      tracker.pulled += chunkBytes
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20))
      return undefined
    },
    cancel() {
      tracker.cancelled = true
      if (keepAlive) clearInterval(keepAlive)
      tracker.socketOpen = false
      if (cancel === 'reject') return Promise.reject(new Error('cancel failed'))
      // A cancellation that never settles, like a peer that never acknowledges the reset.
      if (cancel === 'never') return new Promise(() => undefined)
      return undefined
    },
  }, { highWaterMark: 0 })
  return tracker
}

test('M4: a chunked 200 with no Content-Length is cancelled just past the limit, not read to the end', async () => {
  const body = trackedBody({ chunkBytes: 1024, totalBytes: 1024 * 1024 })
  assert.equal(await send(provider(transport(new Response(body.stream, { status: 200 })).fn)), 'unknown')
  assert.ok(body.pulled <= LIMIT + 1024, `pulled ${body.pulled} bytes; the limit is ${LIMIT}`)
  assert.equal(body.cancelled, true, 'the stream is cancelled, releasing the connection')
})

test('M4: a declared Content-Length over the limit is refused before a single byte is read', async () => {
  const body = trackedBody({ totalBytes: 1024 * 1024 })
  const reply = new Response(body.stream, { status: 200, headers: { 'Content-Length': String(1024 * 1024) } })
  assert.equal(await send(provider(transport(reply).fn)), 'unknown')
  assert.equal(body.pulled, 0)
  assert.equal(body.cancelled, true)
})

test('M4: a body that stalls is abandoned at the request deadline and its connection released', async () => {
  const body = trackedBody({ chunkBytes: 100, stallAfter: 200 })
  const started = Date.now()
  const outcome = await provider(transport(new Response(body.stream, { status: 200 })).fn).send(TO, SMS, AbortSignal.timeout(100))
  assert.equal(outcome, 'unknown')
  assert.ok(Date.now() - started < 2_000, 'the deadline bounds the body read too')
  assert.equal(body.cancelled, true)
  assert.equal(body.socketOpen, false)
})

test('M4: a cancellation that itself rejects never escapes, on oversized, declared and refused responses', async () => {
  const unhandled = []
  const onUnhandled = reason => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const chunked = trackedBody({ chunkBytes: 4096, totalBytes: 64 * 1024, cancel: 'reject' })
    assert.equal(await send(provider(transport(new Response(chunked.stream, { status: 200 })).fn)), 'unknown')
    const declared = trackedBody({ totalBytes: 64 * 1024, cancel: 'reject' })
    assert.equal(await send(provider(transport(new Response(declared.stream, { status: 200,
      headers: { 'Content-Length': '65536' } })).fn)), 'unknown')
    const refused = trackedBody({ totalBytes: 64 * 1024, cancel: 'reject' })
    assert.equal(await send(provider(transport(new Response(refused.stream, { status: 401 })).fn)), 'failed')
    assert.equal(refused.pulled, 0, 'a refusal body is never read')
    assert.ok([chunked, declared, refused].every(body => body.cancelled))
    await new Promise(resolve => setImmediate(resolve))
  } finally { process.off('unhandledRejection', onUnhandled) }
  assert.deepEqual(unhandled, [])
})

test('M4: a stream that errors mid-read, an invalid length and malformed UTF-8 are all unknown, never sent', async () => {
  const failing = trackedBody({ chunkBytes: 512, error: { after: 1024 } })
  assert.equal(await send(provider(transport(new Response(failing.stream, { status: 200 })).fn)), 'unknown')
  for (const length of ['abc', '-1', '1e3', ' ']) {
    const body = trackedBody({ chunks: [new TextEncoder().encode(JSON.stringify(OK_BODY))] })
    assert.equal(await send(provider(transport(new Response(body.stream, { status: 200,
      headers: { 'Content-Length': length } })).fn)), 'unknown', `Content-Length ${JSON.stringify(length)}`)
    assert.equal(body.pulled, 0)
  }
  const invalidUtf8 = trackedBody({ chunks: [new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d])] })
  assert.equal(await send(provider(transport(new Response(invalidUtf8.stream, { status: 200 })).fn)), 'unknown')
})

test('M4: a normal Termii reply split across chunks, and one exactly at the limit, are still read', async () => {
  const text = JSON.stringify(OK_BODY)
  const parts = [text.slice(0, 10), text.slice(10, 40), text.slice(40)].map(part => new TextEncoder().encode(part))
  const split = trackedBody({ chunks: parts })
  assert.equal(await send(provider(transport(new Response(split.stream, { status: 200 })).fn)), 'sent')
  const padded = JSON.stringify({ ...OK_BODY, padding: '' })
  const exact = JSON.stringify({ ...OK_BODY, padding: 'x'.repeat(LIMIT - new TextEncoder().encode(padded).byteLength) })
  assert.equal(new TextEncoder().encode(exact).byteLength, LIMIT)
  assert.equal(await send(provider(transport(new Response(exact, { status: 200 })).fn)), 'sent', 'exactly 8 KiB is allowed')
  assert.equal(await send(provider(transport(new Response(exact + ' ', { status: 200 })).fn)), 'unknown', 'one byte over is not')
})

// ---------------------------------------------------------------------------------------------------------------------
// M4: releasing a body never waits on its cancellation, whatever cancel() does.
// ---------------------------------------------------------------------------------------------------------------------

/** Run a send against a reply, failing (instead of hanging the suite) if it outlives the watchdog. */
async function sendWithWatchdog(reply, deadlineMs = 100, watchdogMs = 2_000) {
  let watchdog
  const started = Date.now()
  try {
    const outcome = await Promise.race([provider(transport(reply).fn).send(TO, SMS, AbortSignal.timeout(deadlineMs)),
      new Promise(resolve => { watchdog = setTimeout(() => resolve('still pending'), watchdogMs) })])
    return { outcome, ms: Date.now() - started }
  } finally { clearTimeout(watchdog) }
}

test('M4: a never-settling cancellation cannot hold a declared-oversized, streamed-oversized or refused reply', async () => {
  const cases = [
    ['declared oversized 200', () => new Response(trackedBody({ totalBytes: 64 * 1024, cancel: 'never' }).stream,
      { status: 200, headers: { 'Content-Length': '65536' } }), 'unknown'],
    ['streamed oversized 200', () => new Response(trackedBody({ chunkBytes: 4096, totalBytes: 1024 * 1024, cancel: 'never' }).stream,
      { status: 200 }), 'unknown'],
    ['401 refusal', () => new Response(trackedBody({ totalBytes: 64 * 1024, cancel: 'never' }).stream, { status: 401 }), 'failed'],
    ['503 error', () => new Response(trackedBody({ totalBytes: 64 * 1024, cancel: 'never' }).stream, { status: 503 }), 'unknown'],
  ]
  for (const [name, reply, expected] of cases) {
    const { outcome, ms } = await sendWithWatchdog(reply())
    assert.equal(outcome, expected, name)
    assert.ok(ms < 1_000, `${name} settled in ${ms} ms`)
  }
})

test('M4: a stalled body whose cancellation never settles still returns at the request deadline', async () => {
  const body = trackedBody({ chunkBytes: 100, stallAfter: 200, cancel: 'never' })
  const { outcome, ms } = await sendWithWatchdog(new Response(body.stream, { status: 200 }), 100)
  assert.equal(outcome, 'unknown', 'the message may have been accepted, so it stays counted')
  assert.ok(ms >= 90 && ms < 1_000, `returned at the deadline (${ms} ms)`)
  assert.equal(body.cancelled, true, 'cancellation was still requested')
})

test('M4: cancellation that resolves, rejects, throws synchronously or never settles never escapes', async () => {
  const unhandled = []
  const onUnhandled = reason => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    for (const cancel of [undefined, 'reject', 'never']) {
      const chunked = trackedBody({ chunkBytes: 4096, totalBytes: 64 * 1024, cancel })
      assert.equal((await sendWithWatchdog(new Response(chunked.stream, { status: 200 }))).outcome, 'unknown', String(cancel))
    }
    // A body whose cancel() throws synchronously (for example, an already locked stream).
    const throwing = { getReader() { throw new Error('locked') }, cancel() { throw new TypeError('locked') } }
    for (const status of [200, 401]) {
      const reply = { status, headers: new Headers(status === 200 ? { 'Content-Length': '99999' } : {}), body: throwing }
      assert.equal((await sendWithWatchdog(reply)).outcome, status === 200 ? 'unknown' : 'failed', `sync throw on ${status}`)
    }
    await new Promise(resolve => setImmediate(resolve))
  } finally { process.off('unhandledRejection', onUnhandled) }
  assert.deepEqual(unhandled, [])
})

test('M4: repeated failures with never-settling cancellation make one request each and leave nothing running', async () => {
  const before = process.getActiveResourcesInfo().length
  let requests = 0
  const replies = [
    () => new Response(trackedBody({ totalBytes: 64 * 1024, cancel: 'never' }).stream, { status: 401 }),
    () => new Response(trackedBody({ chunkBytes: 4096, totalBytes: 1024 * 1024, cancel: 'never' }).stream, { status: 200 }),
    () => new Response(trackedBody({ totalBytes: 64 * 1024, cancel: 'never' }).stream,
      { status: 200, headers: { 'Content-Length': '65536' } }),
  ]
  const p = provider(async () => { requests += 1; return replies[requests % replies.length]() })
  const started = Date.now()
  const outcomes = []
  for (let i = 0; i < 150; i += 1) outcomes.push(await p.send(TO, SMS, AbortSignal.timeout(100)))
  assert.equal(requests, 150, 'no retries and no extra requests')
  assert.ok(outcomes.every(outcome => outcome === 'failed' || outcome === 'unknown'))
  assert.ok(Date.now() - started < 5_000, 'no send waited on a cancellation')
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(process.getActiveResourcesInfo().length <= before, 'no timers, sockets or handles accumulate')
})
