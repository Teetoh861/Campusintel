// lib/ai-practice/extract-isolation.test.cjs — Real hostile PDF and DOCX files are really stopped at the parser's
// deadline and memory budget, in a separate process while a live HTTP server here keeps answering, and nothing is
// left running. Only outcomes are asserted; when each limit falls due is in parser-decisions.test.cjs.
// Run one at a time: in order within this file, and one real-parser file at a time across the batch.
const { after, afterEach, before, test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { strToU8, zipSync } = require('fflate')
const { extractUploadText, parseInIsolation, parserLoad } = require('./extract.ts')
const fixtures = require('./fixtures/adversarial-documents.cjs')
const { holdRealParsers, releaseRealParsers, settleParsers } = require('./fixtures/real-parsers.cjs')

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MB = 1024 * 1024
// Real processes on a possibly loaded machine: generous, and only reached when something is stuck.
const HARD_TIMEOUT = { timeout: 90_000 }
// For parses whose subject is not the deadline: a slow or swapping machine must not turn their answer into 'timeout'.
const SLOW_HOST = { timeoutMs: 60_000 }
// One poll of the server here; a reply this late means the server is stuck, not slow.
const REPLY_TIMEOUT_MS = 30_000
const validDocx = () => zipSync({ 'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>Notes</w:t></w:r></w:p></w:document>') })
const validPdf = () => fixtures.pdfFromObjects(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  { dict: '<< /Length %LENGTH% >>', stream: Buffer.from('BT /F1 12 Tf 72 720 Td (Valid notes.) Tj ET') },
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'])

/**
 * A real HTTP server in this process, polled throughout `work`. Returns the work's value and how many replies
 * arrived while a parser process was running beside this one.
 */
async function whileServing(work) {
  const server = http.createServer((request, response) => response.end('ok'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  let polling = true
  let repliesWhileParsing = 0
  const poller = (async () => {
    while (polling) {
      const parsing = parserLoad().processes > 0
      assert.equal(await (await fetch(url, { signal: AbortSignal.timeout(REPLY_TIMEOUT_MS) })).text(), 'ok')
      if (parsing && parserLoad().processes > 0) repliesWhileParsing += 1
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  })()
  try {
    const value = await work()
    return { value, repliesWhileParsing }
  } finally {
    polling = false
    await poller
    await new Promise(resolve => server.close(resolve))
  }
}

// One real-parser file at a time on this machine, and a failed test leaves nothing behind for the next one.
before(holdRealParsers)
after(releaseRealParsers)
afterEach(() => settleParsers(parserLoad))

const settledCleanly = () => assert.deepEqual(parserLoad(), { active: 0, queued: 0, processes: 0, samplers: 0 },
  'no parser process, slot or queue entry outlives the answer')

test('a CPU-bound PDF is killed at its deadline in its own process while this server keeps answering', HARD_TIMEOUT, async () => {
  const pdf = fixtures.cpuBoundPdf()
  assert.ok(pdf.length < 100_000, `a ${pdf.length}-byte upload`)
  const { value: report, repliesWhileParsing } = await whileServing(() => parseInIsolation('pdf', pdf, { timeoutMs: 1_500 }))
  assert.equal(report.outcome, 'timeout')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'corrupt' })
  // The replaced main-thread parser blocked this loop on the same file; here the parse runs in another process.
  assert.ok(repliesWhileParsing >= 1, 'the server answered while the parser was running')
  settledCleanly()
})

test('the same PDF still has not finished at three times that deadline: the kill is real, not a near miss', HARD_TIMEOUT, async () => {
  const report = await parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 4_500 })
  assert.equal(report.outcome, 'timeout')
  settledCleanly()
})

test('a PDF inflating to a gigabyte off-heap is killed at the resident-memory budget', HARD_TIMEOUT, async () => {
  const pdf = await fixtures.inflationBombPdf()
  assert.ok(pdf.length < 2 * MB, `a ${pdf.length}-byte upload`)
  const budget = 192 * MB
  const { value: report, repliesWhileParsing } = await whileServing(() => parseInIsolation('pdf', pdf, { ...SLOW_HOST, maxResidentBytes: budget }))
  assert.equal(report.outcome, 'memory')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'too-much-text' })
  // Measured over the budget, from this process; how far past it a sample lands depends on the machine's speed.
  assert.ok(report.peakResidentBytes > budget, `peak ${(report.peakResidentBytes / MB).toFixed(0)} MB`)
  assert.ok(repliesWhileParsing >= 1, 'the server answered while the parser was running')
  settledCleanly()
})

test('a PDF exhausting the V8 heap aborts only its parser process', HARD_TIMEOUT, async () => {
  // In a worker thread this exact file aborted the whole server process; a child process contains it.
  const report = await parseInIsolation('pdf', fixtures.hugeArrayPdf(), { ...SLOW_HOST, maxHeapMb: 64, maxResidentBytes: 4096 * MB })
  assert.equal(report.outcome, 'memory')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'too-much-text' })
  settledCleanly()
})

test('a real DOCX with repeated unmatched XML delimiters is refused by the parser, not by the deadline', HARD_TIMEOUT, async () => {
  const docx = fixtures.unmatchedDelimiterDocx()
  // The regex reader did not finish this file in 30 s; the scanner refuses it at the first stray '<'. 'ok' means
  // the parser answered, well before the 20 s deadline would have answered 'timeout'.
  const report = await parseInIsolation('docx', docx, SLOW_HOST)
  assert.equal(report.outcome, 'ok')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'corrupt' })
  assert.deepEqual(await extractUploadText(docx, DOCX), { status: 'rejected', reason: 'corrupt' }, 'through the upload entry point')
  settledCleanly()
})

test('DOCX parsing is under the same deadline and memory budget, and the archive checks still hold', HARD_TIMEOUT, async () => {
  // No process can start and answer within 1 ms.
  assert.equal((await parseInIsolation('docx', validDocx(), { timeoutMs: 1 })).outcome, 'timeout')
  // Valid, markup-heavy and near the 16 MB part cap, so it parses for a while; any real process is larger
  // than one megabyte resident, so the first sample ends it.
  let markup = ''
  for (let index = 0; markup.length < 15 * MB; index += 1) markup += `<w:p w:rsidR="${(index * 2654435761 >>> 0).toString(16)}"/>`
  const heavy = zipSync({ 'word/document.xml': strToU8(`<w:document>${markup}</w:document>`) })
  const starved = await parseInIsolation('docx', heavy, { ...SLOW_HOST, maxResidentBytes: MB })
  assert.equal(starved.outcome, 'memory')
  assert.deepEqual(starved.result, { status: 'rejected', reason: 'too-much-text' })
  assert.equal((await parseInIsolation('docx', heavy, SLOW_HOST)).result.status, 'ok',
    'and parses within the normal memory budget')
  // A part declaring more than 16 MB is refused before inflation, even at a believable compression ratio.
  let noise = ''
  for (let index = 0; noise.length < 17 * MB; index += 1) noise += (index * 2654435761 >>> 0).toString(36)
  const large = zipSync({ 'word/document.xml': strToU8(`<w:document><w:p><w:r><w:t>${noise}</w:t></w:r></w:p></w:document>`) })
  assert.deepEqual((await parseInIsolation('docx', large, SLOW_HOST)).result, { status: 'rejected', reason: 'too-much-text' })
  assert.deepEqual((await parseInIsolation('docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]), SLOW_HOST)).result,
    { status: 'rejected', reason: 'corrupt' })
  assert.deepEqual((await parseInIsolation('docx', validDocx(), SLOW_HOST)).result, { status: 'ok', text: 'Notes\n' })
  settledCleanly()
})

test('real parses beyond the pool wait their turn: at most two parser processes ever run at once', HARD_TIMEOUT, async () => {
  let peak = 0
  const watch = setInterval(() => { peak = Math.max(peak, parserLoad().processes) }, 5)
  try {
    const reports = await Promise.all(Array.from({ length: 5 }, () => parseInIsolation('docx', validDocx(), { ...SLOW_HOST, queueWaitMs: 60_000 })))
    assert.ok(reports.every(report => report.outcome === 'ok' && report.result.text === 'Notes\n'), 'every waiter is served')
  } finally {
    clearInterval(watch)
  }
  assert.ok(peak <= 2, `${peak} parser processes at once`)
  settledCleanly()
})

test('a deployment missing the parser answers unavailable instead of rejecting the student file', HARD_TIMEOUT, async () => {
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

test('ordinary files parse normally after every hostile one', HARD_TIMEOUT, async () => {
  assert.deepEqual((await parseInIsolation('pdf', validPdf(), SLOW_HOST)).result, { status: 'ok', text: 'Valid notes.' })
  assert.deepEqual((await parseInIsolation('docx', validDocx(), SLOW_HOST)).result, { status: 'ok', text: 'Notes\n' })
  settledCleanly()
})
