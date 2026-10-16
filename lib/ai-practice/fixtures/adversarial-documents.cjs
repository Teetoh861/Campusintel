// lib/ai-practice/fixtures/adversarial-documents.cjs — Real, byte-exact hostile PDF and DOCX files for parser tests.
// Built deterministically at test time instead of committing binaries; each is a structurally valid file.
'use strict'
const { createDeflate, deflateSync } = require('node:zlib')
const { strToU8, zipSync } = require('fflate')

const latin1 = text => Buffer.from(text, 'latin1')

/** A PDF from object bodies (strings or { dict, stream } with raw bytes), with a correct xref table. */
function pdfFromObjects(objects) {
  const chunks = [latin1('%PDF-1.7\n')]
  let length = chunks[0].length
  const offsets = objects.map((object, index) => {
    const offset = length
    const parts = typeof object === 'string'
      ? [latin1(`${index + 1} 0 obj\n${object}\nendobj\n`)]
      : [latin1(`${index + 1} 0 obj\n${object.dict.replace('%LENGTH%', String(object.stream.length))}\nstream\n`),
        object.stream, latin1('\nendstream\nendobj\n')]
    for (const part of parts) { chunks.push(part); length += part.length }
    return offset
  })
  const tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`
  chunks.push(latin1(tail))
  return new Uint8Array(Buffer.concat(chunks))
}

const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

/** Pages that all share one Flate content stream (objects: 1 catalog, 2 pages, 3 font, 4 stream, 5.. pages). */
function sharedContentPdf(pageCount, content, extraResources = '', extraObjects = [], { precompressed = false } = {}) {
  const firstPage = 5 + extraObjects.length
  const kids = Array.from({ length: pageCount }, (_, index) => `${firstPage + index} 0 R`).join(' ')
  const page = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ` +
    `/Resources << /Font << /F1 3 0 R >> ${extraResources} >> >>`
  return pdfFromObjects([
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
    FONT,
    { dict: '<< /Length %LENGTH% /Filter /FlateDecode >>', stream: precompressed ? content : deflateSync(content, { level: 9 }) },
    ...extraObjects,
    ...Array.from({ length: pageCount }, () => page),
  ])
}

/**
 * CPU-bound: 300 pages (the page cap) each re-reading one small compressed stream of path operators that
 * yield no text, so neither the text cap nor the memory budget stops it; only the deadline does.
 */
function cpuBoundPdf({ pages = 300, operatorsPerPage = 400_000 } = {}) {
  return sharedContentPdf(pages, latin1('1 0 0 1 0 0 cm 0 0 m\n'.repeat(operatorsPerPage)))
}

/**
 * Off-heap: one content stream that inflates to about a gigabyte from roughly a megabyte on disk. The stream
 * is compressed chunk by chunk, so building the fixture never holds the inflated bytes.
 */
async function inflationBombPdf({ inflatedBytes = 1024 * 1024 * 1024 } = {}) {
  const deflate = createDeflate({ level: 9 })
  const compressed = []
  deflate.on('data', chunk => compressed.push(chunk))
  const done = new Promise((resolve, reject) => { deflate.on('end', resolve); deflate.on('error', reject) })
  const chunk = Buffer.alloc(1024 * 1024, 0x20)
  for (let written = 0; written < inflatedBytes; written += chunk.length) {
    if (!deflate.write(chunk)) await new Promise(resolve => deflate.once('drain', resolve))
  }
  deflate.end()
  await done
  return sharedContentPdf(1, Buffer.concat(compressed), '', [], { precompressed: true })
}

/**
 * Heap: one text-showing operator whose argument array holds millions of numbers. The compressed stream is
 * tiny and its inflated bytes stay well inside the off-heap budget, but pdf.js builds the whole array as JS
 * values before the operator runs, so only the V8 heap limit stops it.
 */
function hugeArrayPdf({ numbers = 16_000_000 } = {}) {
  return sharedContentPdf(1, Buffer.concat([latin1('BT /F1 12 Tf ['), Buffer.alloc(numbers * 2, '0 '), latin1('] TJ ET')]))
}

/** Deterministic pseudo-random letters, so malformed XML compresses about as poorly as real text. */
function noise(length, seed = 1) {
  let state = seed
  let out = ''
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0
    out += String.fromCharCode(97 + (state >>> 16) % 26)
  }
  return out
}

/**
 * Malformed DOCX: a real archive whose document.xml opens a w:t element and then repeats an unmatched '<'
 * with no closing '>'. The earlier regex reader rescanned to the end of the part from every '<'.
 */
function unmatchedDelimiterDocx({ repeats = 200_000 } = {}) {
  let body = ''
  for (let index = 0; index < repeats; index += 1) body += `<${noise(3, index + 1)} `
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document><w:body><w:p><w:r><w:t ${body}`
  return zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) })
}

module.exports = { pdfFromObjects, cpuBoundPdf, inflationBombPdf, hugeArrayPdf, unmatchedDelimiterDocx }
