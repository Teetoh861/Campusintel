// lib/ai-practice/extract-isolation.test.cjs — Hostile PDF and DOCX files against the parser's deadline, memory budget,
// termination, concurrency bound and cleanup, with a live HTTP server proving this process stays responsive.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { monitorEventLoopDelay } = require('node:perf_hooks')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { strToU8, zipSync } = require('fflate')
const { extractUploadText, parseInIsolation, parserLoad } = require('./extract.ts')
const fixtures = require('./fixtures/adversarial-documents.cjs')
const { EARLY_TIMER_TOLERANCE_MS } = require('./fixtures/timer-tolerance.cjs')

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MB = 1024 * 1024
const STALL_LIMIT_MS = 500
const validDocx = () => zipSync({ 'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>Notes</w:t></w:r></w:p></w:document>') })
const validPdf = () => fixtures.pdfFromObjects(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  { dict: '<< /Length %LENGTH% >>', stream: Buffer.from('BT /F1 12 Tf 72 720 Td (Valid notes.) Tj ET') },
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'])

/**
 * A real HTTP server in this process, polled throughout `work`. Returns the work's value, the slowest reply
 * and the worst event-loop stall of this process while the work ran.
 */
async function whileServing(work) {
  const server = http.createServer((request, response) => response.end('ok'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  // The first fetch in a process loads its HTTP client; that one-off cost is not the parser's.
  await (await fetch(url)).text()
  const stalls = monitorEventLoopDelay({ resolution: 10 })
  stalls.enable()
  let polling = true
  let slowestMs = 0
  let replies = 0
  const poller = (async () => {
    while (polling) {
      const started = performance.now()
      assert.equal(await (await fetch(url)).text(), 'ok')
      slowestMs = Math.max(slowestMs, performance.now() - started)
      replies += 1
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  })()
  try {
    const value = await work()
    return { value, slowestMs, replies, worstStallMs: stalls.max / 1e6 }
  } finally {
    stalls.disable()
    polling = false
    await poller
    await new Promise(resolve => server.close(resolve))
  }
}

const settledCleanly = () => assert.deepEqual(parserLoad(), { active: 0, queued: 0, processes: 0, samplers: 0 },
  'no parser process, slot or queue entry outlives the answer')

test('a CPU-bound PDF is killed at its deadline while this server keeps answering', async () => {
  const pdf = fixtures.cpuBoundPdf()
  assert.ok(pdf.length < 100_000, `a ${pdf.length}-byte upload`)
  const { value: report, slowestMs, replies, worstStallMs } =
    await whileServing(() => parseInIsolation('pdf', pdf, { timeoutMs: 1_500 }))
  assert.equal(report.outcome, 'timeout')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'corrupt' })
  // Killed at the deadline; the slack covers the reap and a heavily loaded test machine, not more parsing.
  assert.ok(report.elapsedMs >= 1_500 && report.elapsedMs < 4_000, `answered after ${report.elapsedMs} ms`)
  assert.ok(replies >= 10, `${replies} replies during the parse`)
  // The replaced main-thread parser stalled this loop for over a second on the same file; these bounds
  // leave room for scheduler noise when every suite runs at once.
  assert.ok(slowestMs < STALL_LIMIT_MS, `slowest reply ${slowestMs.toFixed(0)} ms`)
  assert.ok(worstStallMs < STALL_LIMIT_MS, `worst event-loop stall ${worstStallMs.toFixed(0)} ms`)
  settledCleanly()
})

test('the same PDF still has not finished at three times that deadline: the kill is real, not a near miss', async () => {
  const report = await parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 4_500 })
  assert.equal(report.outcome, 'timeout')
  settledCleanly()
})

test('a PDF inflating to a gigabyte off-heap is killed at the resident-memory budget', async () => {
  const pdf = await fixtures.inflationBombPdf()
  assert.ok(pdf.length < 2 * MB, `a ${pdf.length}-byte upload`)
  const budget = 192 * MB
  const { value: report, slowestMs } = await whileServing(() => parseInIsolation('pdf', pdf, { maxResidentBytes: budget }))
  assert.equal(report.outcome, 'memory')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'too-much-text' })
  // Sampling overshoots by at most what the parser can write between two samples.
  assert.ok(report.peakResidentBytes > budget && report.peakResidentBytes < budget + 256 * MB,
    `peak ${(report.peakResidentBytes / MB).toFixed(0)} MB`)
  assert.ok(slowestMs < STALL_LIMIT_MS, `slowest reply ${slowestMs.toFixed(0)} ms`)
  settledCleanly()
})

test('a PDF exhausting the V8 heap aborts only its parser process', async () => {
  // In a worker thread this exact file aborted the whole server process; a child process contains it.
  const report = await parseInIsolation('pdf', fixtures.hugeArrayPdf(), { maxHeapMb: 64, maxResidentBytes: 4096 * MB })
  assert.equal(report.outcome, 'memory')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'too-much-text' })
  settledCleanly()
})

test('a real DOCX with repeated unmatched XML delimiters is refused in bounded time', async () => {
  const docx = fixtures.unmatchedDelimiterDocx()
  const { value: report, slowestMs, worstStallMs } = await whileServing(() => parseInIsolation('docx', docx))
  assert.equal(report.outcome, 'ok')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'corrupt' })
  // The regex reader did not finish this file in 30 s; the scanner refuses it at the first stray '<'.
  assert.ok(report.elapsedMs < 10_000, `${report.elapsedMs} ms`)
  assert.ok(slowestMs < STALL_LIMIT_MS, `slowest reply ${slowestMs.toFixed(0)} ms`)
  assert.ok(worstStallMs < STALL_LIMIT_MS, `worst event-loop stall ${worstStallMs.toFixed(0)} ms`)
  assert.deepEqual(await extractUploadText(docx, DOCX), { status: 'rejected', reason: 'corrupt' }, 'through the upload entry point')
  settledCleanly()
})

test('DOCX parsing is under the same deadline and memory budget, and the archive checks still hold', async () => {
  assert.equal((await parseInIsolation('docx', validDocx(), { timeoutMs: 1 })).outcome, 'timeout')
  // Valid, markup-heavy and near the 16 MB part cap, so it parses for a while; any real process is larger
  // than one megabyte resident, so the first sample ends it.
  let markup = ''
  for (let index = 0; markup.length < 15 * MB; index += 1) markup += `<w:p w:rsidR="${(index * 2654435761 >>> 0).toString(16)}"/>`
  const heavy = zipSync({ 'word/document.xml': strToU8(`<w:document>${markup}</w:document>`) })
  const starved = await parseInIsolation('docx', heavy, { maxResidentBytes: MB })
  assert.equal(starved.outcome, 'memory')
  assert.deepEqual(starved.result, { status: 'rejected', reason: 'too-much-text' })
  assert.equal((await parseInIsolation('docx', heavy)).result.status, 'ok', 'and parses within the normal budget')
  // A part declaring more than 16 MB is refused before inflation, even at a believable compression ratio.
  let noise = ''
  for (let index = 0; noise.length < 17 * MB; index += 1) noise += (index * 2654435761 >>> 0).toString(36)
  const large = zipSync({ 'word/document.xml': strToU8(`<w:document><w:p><w:r><w:t>${noise}</w:t></w:r></w:p></w:document>`) })
  assert.deepEqual((await parseInIsolation('docx', large)).result, { status: 'rejected', reason: 'too-much-text' })
  assert.deepEqual((await parseInIsolation('docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]))).result,
    { status: 'rejected', reason: 'corrupt' })
  assert.deepEqual((await parseInIsolation('docx', validDocx())).result, { status: 'ok', text: 'Notes\n' })
  settledCleanly()
})

test('at most two parsers run at once; waiters time out and a full queue is refused at once', async () => {
  const peaks = { active: 0 }
  const watch = setInterval(() => { peaks.active = Math.max(peaks.active, parserLoad().active) }, 5).unref()
  const slow = () => parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 1_200, queueWaitMs: 5_000 })
  const running = [slow(), slow()]
  const queued = Array.from({ length: 7 }, () => parseInIsolation('docx', validDocx(), { queueWaitMs: 5_000 }))
  await new Promise(resolve => setTimeout(resolve, 50))
  const load = parserLoad()
  assert.deepEqual({ ...load, samplers: 0 }, { active: 2, queued: 7, processes: 2, samplers: 0 })
  assert.ok(load.samplers <= 2, `${load.samplers} memory samplers for two parsers`)
  const impatient = await parseInIsolation('docx', validDocx(), { queueWaitMs: 100 })
  assert.equal(impatient.outcome, 'unavailable', 'a waiter gives up when its wait runs out')
  assert.ok(impatient.elapsedMs >= 100 - EARLY_TIMER_TOLERANCE_MS && impatient.elapsedMs < 1_000, `${impatient.elapsedMs} ms`)
  queued.push(parseInIsolation('docx', validDocx(), { queueWaitMs: 5_000 }))
  assert.equal(parserLoad().queued, 8)
  const overflow = await parseInIsolation('docx', validDocx())
  assert.equal(overflow.outcome, 'unavailable', 'a ninth waiter is refused')
  assert.ok(overflow.elapsedMs < 90, `without waiting: ${overflow.elapsedMs} ms`)
  assert.deepEqual((await Promise.all(running)).map(report => report.outcome), ['timeout', 'timeout'])
  const served = await Promise.all(queued)
  assert.ok(served.every(report => report.outcome === 'ok' && report.result.status === 'ok'), 'queued parses run afterwards')
  clearInterval(watch)
  assert.equal(peaks.active, 2)
  settledCleanly()
})

test('a deployment missing the parser answers unavailable instead of rejecting the student file', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-practice-no-parser-'))
  const original = process.cwd()
  const modulePath = require.resolve('./parser-process.ts')
  const cached = require.cache[modulePath]
  try {
    // The parser path is resolved from the working directory when the module loads, as in a deployed function.
    process.chdir(empty)
    delete require.cache[modulePath]
    const isolated = require('./parser-process.ts')
    process.chdir(original)
    const report = await isolated.parseInIsolation('pdf', validPdf())
    assert.deepEqual(report, { ...report, outcome: 'unavailable', result: { status: 'unavailable' } })
    assert.deepEqual(isolated.parserLoad(), { active: 0, queued: 0, processes: 0, samplers: 0 })
  } finally {
    process.chdir(original)
    require.cache[modulePath] = cached
    fs.rmSync(empty, { recursive: true, force: true })
  }
})

test('ordinary files parse normally after every hostile one', async () => {
  assert.deepEqual((await parseInIsolation('pdf', validPdf())).result, { status: 'ok', text: 'Valid notes.' })
  assert.deepEqual((await parseInIsolation('docx', validDocx())).result, { status: 'ok', text: 'Notes\n' })
  settledCleanly()
})
