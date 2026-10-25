// lib/ai-practice/extract-isolation.test.cjs — Real hostile PDF and DOCX files are really stopped at the parser's
// deadline and memory budget, in a separate process that this one forks, and nothing is left running. This process
// never loads the PDF or DOCX parser, so no file can block it. Only outcomes are asserted; when each limit falls due
// is in parser-decisions.test.cjs. Run one at a time: in order within this file, and one real-parser file at a time
// across the batch.
const Module = require('node:module')
// Every module this process resolves, by require or import, from before the parser pool is loaded.
const resolvedHere = []
Module.registerHooks({ resolve(specifier, context, nextResolve) {
  const resolved = nextResolve(specifier, context)
  resolvedHere.push(resolved.url)
  return resolved
} })
const { after, afterEach, before, mock, test } = require('node:test')
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
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
const validDocx = () => zipSync({ 'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>Notes</w:t></w:r></w:p></w:document>') })
const validPdf = () => fixtures.pdfFromObjects(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  { dict: '<< /Length %LENGTH% >>', stream: Buffer.from('BT /F1 12 Tf 72 720 Td (Valid notes.) Tj ET') },
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'])

// The parser's own code: extract-parser.cjs, the PDF library it imports and the DOCX scanner it requires. None may
// ever load in this process.
const PARSER_MODULE = /\/lib\/ai-practice\/(?:extract-parser|word-xml)\.cjs$|\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?unpdf\//

/** Fail if this process has loaded the parser; the hook is shown live by its record of the parser pool itself. */
function parserNeverLoadedHere() {
  assert.ok(resolvedHere.some(url => url.endsWith('/lib/ai-practice/parser-process.ts')), 'the module hook is recording')
  assert.deepEqual(resolvedHere.filter(url => PARSER_MODULE.test(url)), [], 'this process never loads the parser')
}

/** Run `work` while recording every fork; returns the work's value and the forked module paths. */
async function recordingForks(work) {
  const forked = []
  const fork = childProcess.fork
  mock.method(childProcess, 'fork', (file, ...args) => { forked.push(file); return fork.call(childProcess, file, ...args) })
  try {
    return { value: await work(), forked }
  } finally {
    mock.restoreAll()
  }
}

// One real-parser file at a time on this machine, and a failed test leaves nothing behind for the next one.
before(holdRealParsers)
after(releaseRealParsers)
afterEach(() => settleParsers(parserLoad))

const settledCleanly = () => assert.deepEqual(parserLoad(), { active: 0, queued: 0, processes: 0, samplers: 0 },
  'no parser process, slot or queue entry outlives the answer')

test('a CPU-bound PDF is killed at its deadline in a forked parser; this process never loads the parser', HARD_TIMEOUT, async () => {
  const pdf = fixtures.cpuBoundPdf()
  assert.ok(pdf.length < 100_000, `a ${pdf.length}-byte upload`)
  const { value: report, forked } = await recordingForks(() => parseInIsolation('pdf', pdf, { timeoutMs: 1_500 }))
  assert.equal(report.outcome, 'timeout')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'corrupt' })
  // The replaced main-thread parser blocked the server on this file. Here the PDF code runs only in the forked child,
  // so however long it computes, it cannot block this process.
  assert.deepEqual(forked.map(file => path.basename(file)), ['extract-parser.cjs'])
  parserNeverLoadedHere()
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
  const report = await parseInIsolation('pdf', pdf, { ...SLOW_HOST, maxResidentBytes: budget })
  assert.equal(report.outcome, 'memory')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'too-much-text' })
  // Measured over the budget, from this process; how far past it a sample lands depends on the machine's speed.
  assert.ok(report.peakResidentBytes > budget, `peak ${(report.peakResidentBytes / MB).toFixed(0)} MB`)
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

test('DOCX parsing is under the same deadline: no process can start and answer within 1 ms', HARD_TIMEOUT, async () => {
  assert.equal((await parseInIsolation('docx', validDocx(), { timeoutMs: 1 })).outcome, 'timeout')
  settledCleanly()
})

let heavy
/** Valid, markup-heavy and near the 16 MB part cap, so it parses for a while. Built once for the two tests below. */
function heavyDocx() {
  if (heavy) return heavy
  let markup = ''
  for (let index = 0; markup.length < 15 * MB; index += 1) markup += `<w:p w:rsidR="${(index * 2654435761 >>> 0).toString(16)}"/>`
  heavy = zipSync({ 'word/document.xml': strToU8(`<w:document>${markup}</w:document>`) })
  return heavy
}

test('DOCX parsing is under the same memory budget: a heavy document is stopped at one megabyte', HARD_TIMEOUT, async () => {
  // Any real process is larger than one megabyte resident, so the first sample ends it.
  const starved = await parseInIsolation('docx', heavyDocx(), { ...SLOW_HOST, maxResidentBytes: MB })
  assert.equal(starved.outcome, 'memory')
  assert.deepEqual(starved.result, { status: 'rejected', reason: 'too-much-text' })
  settledCleanly()
})

test('the same heavy DOCX parses within the normal memory budget', HARD_TIMEOUT, async () => {
  assert.equal((await parseInIsolation('docx', heavyDocx(), SLOW_HOST)).result.status, 'ok')
  settledCleanly()
})

test('a DOCX part declaring more than 16 MB is refused before inflation, even at a believable compression ratio', HARD_TIMEOUT, async () => {
  let noise = ''
  for (let index = 0; noise.length < 17 * MB; index += 1) noise += (index * 2654435761 >>> 0).toString(36)
  const large = zipSync({ 'word/document.xml': strToU8(`<w:document><w:p><w:r><w:t>${noise}</w:t></w:r></w:p></w:document>`) })
  assert.deepEqual((await parseInIsolation('docx', large, SLOW_HOST)).result, { status: 'rejected', reason: 'too-much-text' })
  settledCleanly()
})

test('a broken archive is refused as corrupt, and a valid DOCX still parses', HARD_TIMEOUT, async () => {
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

test('after every hostile file above, this process has still never loaded the parser', HARD_TIMEOUT, () => {
  parserNeverLoadedHere()
})
