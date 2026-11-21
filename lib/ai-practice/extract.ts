// lib/ai-practice/extract.ts — Bounded, content-sniffed text extraction for PDF, DOCX and TXT uploads.
// The declared type must match the bytes. Nothing here executes document scripts, fonts or macros.
// PDF and DOCX parsing runs in extract-parser.cjs under parser-process.ts, which kills it at a deadline or memory budget.
import 'server-only'
import { MAX_RAW_TEXT_CHARS, parseInIsolation } from './parser-process'
import type { ParserLimits } from './parser-process'
import { MAX_UPLOAD_BYTES } from './upload-contract'
import type { UploadMediaType, UploadRejection } from './upload-contract'

export { parseInIsolation, parserLoad } from './parser-process'
export type { ParseOutcome, ParseReport, ParserKind, ParserLimits } from './parser-process'

export type ExtractionResult =
  | { status: 'ok'; text: string }
  | { status: 'rejected'; reason: Exclude<UploadRejection, 'missing-upload' | 'too-short'> }
  // No parser was free or the parser could not start: the file is not judged, and the claim is released.
  | { status: 'unavailable' }

const startsWith = (bytes: Uint8Array, signature: ReadonlyArray<number>, offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value)

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
// PDF permits a little leading junk before the header; readers look within the first kilobyte.
const PDF_HEADER_WINDOW = 1024

function findPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - PDF_SIGNATURE.length, PDF_HEADER_WINDOW)
  for (let offset = 0; offset <= limit; offset += 1) if (startsWith(bytes, PDF_SIGNATURE, offset)) return true
  return false
}

/** An OLE compound file is either a legacy .doc or an encrypted Office file; only the latter names this stream. */
function isEncryptedOfficeFile(bytes: Uint8Array): boolean {
  const marker = Buffer.from('EncryptionInfo', 'utf16le')
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(marker)
}

/** Extract PDF text in an isolated, killable parser process within one deadline and memory budget. */
export async function extractPdfText(bytes: Uint8Array, limits?: Partial<ParserLimits>): Promise<ExtractionResult> {
  return (await parseInIsolation('pdf', bytes, limits)).result
}

/** Extract DOCX text the same way: inflate only word/document.xml, then read it with a strict linear scanner. */
export async function extractDocxText(bytes: Uint8Array, limits?: Partial<ParserLimits>): Promise<ExtractionResult> {
  return (await parseInIsolation('docx', bytes, limits)).result
}

function extractPlainText(bytes: Uint8Array): ExtractionResult {
  let text: string
  if (startsWith(bytes, [0xff, 0xfe])) text = new TextDecoder('utf-16le').decode(bytes.subarray(2))
  else if (startsWith(bytes, [0xfe, 0xff])) text = new TextDecoder('utf-16be').decode(bytes.subarray(2))
  else {
    if (bytes.includes(0)) return { status: 'rejected', reason: 'unsupported-type' }
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    // Windows "ANSI" notes are common; Windows-1252 decodes every byte, so binary is caught below instead.
    catch { text = new TextDecoder('windows-1252').decode(bytes) }
  }
  const controls = (text.match(/[\u0000-\u0008\u000E-\u001F]/g) ?? []).length
  if (controls > text.length / 100) return { status: 'rejected', reason: 'unsupported-type' }
  if (text.length > MAX_RAW_TEXT_CHARS) return { status: 'rejected', reason: 'too-much-text' }
  return { status: 'ok', text }
}

/** Extract text after checking size and that the bytes really are the declared kind of file. */
export async function extractUploadText(bytes: Uint8Array, declared: UploadMediaType): Promise<ExtractionResult> {
  if (bytes.byteLength === 0) return { status: 'rejected', reason: 'empty' }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { status: 'rejected', reason: 'too-large' }
  if (startsWith(bytes, CFB_SIGNATURE)) {
    return { status: 'rejected', reason: isEncryptedOfficeFile(bytes) ? 'encrypted' : 'unsupported-type' }
  }
  const result = declared === 'application/pdf'
    ? findPdfHeader(bytes) ? await extractPdfText(bytes) : { status: 'rejected' as const, reason: 'unsupported-type' as const }
    : declared === 'text/plain'
      ? findPdfHeader(bytes) || startsWith(bytes, ZIP_SIGNATURE)
        ? { status: 'rejected' as const, reason: 'unsupported-type' as const } : extractPlainText(bytes)
      : startsWith(bytes, ZIP_SIGNATURE) ? await extractDocxText(bytes)
        : { status: 'rejected' as const, reason: 'unsupported-type' as const }
  if (result.status === 'ok' && result.text.trim().length === 0) return { status: 'rejected', reason: 'empty' }
  return result
}
