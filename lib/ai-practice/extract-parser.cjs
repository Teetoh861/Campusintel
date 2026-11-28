// lib/ai-practice/extract-parser.cjs — Parses one PDF or DOCX inside a disposable child process.
// extract.ts owns the deadline, the memory budget and termination; this file only parses and answers once.
// Plain CommonJS outside the Next.js bundle: next.config.mjs traces it and its dependencies into the function.
'use strict'

/** @typedef {{ maxRawTextChars: number, maxPdfPages: number, maxDocxXmlBytes: number, maxDocxCompressionRatio: number }} Limits */

function pageText(items) {
  return items.map(item => typeof item.str === 'string' ? item.str + (item.hasEOL === true ? '\n' : '') : '').join('')
}

/** @param {Uint8Array} bytes @param {Limits} limits */
async function extractPdf(bytes, limits) {
  let getDocument
  try { ({ getDocument } = await import('unpdf/pdfjs')) } catch { return { status: 'unavailable' } }
  try {
    const document = await getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, enableXfa: false,
      isEvalSupported: false,
      // Errors only: missing standard-font data is irrelevant to text extraction.
      verbosity: 0 }).promise
    if (document.numPages > limits.maxPdfPages) return { status: 'rejected', reason: 'too-much-text' }
    const pages = []
    let total = 0
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      const text = pageText((await page.getTextContent()).items)
      page.cleanup()
      total += text.length
      if (total > limits.maxRawTextChars) return { status: 'rejected', reason: 'too-much-text' }
      pages.push(text)
    }
    return { status: 'ok', text: pages.join('\n\n') }
  } catch (error) {
    return { status: 'rejected', reason: error instanceof Error && error.name === 'PasswordException' ? 'encrypted' : 'corrupt' }
  }
}

/** @param {Uint8Array} bytes @param {Limits} limits */
function extractDocx(bytes, limits) {
  let unzipSync, wordXmlToText
  try { ({ unzipSync } = require('fflate')); ({ wordXmlToText } = require('./word-xml.cjs')) } catch { return { status: 'unavailable' } }
  let xml
  let oversized = false
  try {
    const files = unzipSync(bytes, {
      // Only the main document part is ever inflated, and only within declared size and ratio bounds.
      filter: file => {
        if (file.name !== 'word/document.xml') return false
        oversized = file.originalSize > limits.maxDocxXmlBytes ||
          file.originalSize > Math.max(1, file.size) * limits.maxDocxCompressionRatio
        return !oversized
      },
    })
    xml = files['word/document.xml']
  } catch {
    return { status: 'rejected', reason: 'corrupt' }
  }
  if (oversized) return { status: 'rejected', reason: 'too-much-text' }
  if (!xml) return { status: 'rejected', reason: 'unsupported-type' }
  // The declared size is the archive's claim; the inflated part is checked again.
  if (xml.byteLength > limits.maxDocxXmlBytes) return { status: 'rejected', reason: 'too-much-text' }
  let decoded
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(xml) } catch { return { status: 'rejected', reason: 'corrupt' } }
  const parsed = wordXmlToText(decoded, limits.maxRawTextChars)
  if (parsed.status === 'malformed') return { status: 'rejected', reason: 'corrupt' }
  if (parsed.status === 'too-much-text') return { status: 'rejected', reason: 'too-much-text' }
  return { status: 'ok', text: parsed.text }
}

async function parse({ kind, bytes, limits }) {
  try {
    return await (kind === 'pdf' ? extractPdf(bytes, limits) : extractDocx(bytes, limits))
  } catch {
    return { status: 'rejected', reason: 'corrupt' }
  }
}

// One request per process. The parent kills this process once it has the answer, or sooner.
process.once('message', request => { parse(request).then(result => process.send(result)) })
// An orphan stops as soon as it can notice its parent has gone.
process.once('disconnect', () => process.exit(0))
