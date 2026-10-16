// lib/ai-practice/extract.test.cjs — File safety: sniffing, size, decompression bombs, encodings and real extraction.
// Hostile parser input, deadlines and memory budgets are covered by extract-isolation.test.cjs.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { strToU8, zipSync } = require('fflate')
const { extractUploadText, parseInIsolation, parserLoad } = require('./extract.ts')
const { pdfFromObjects } = require('./fixtures/adversarial-documents.cjs')
const { MAX_UPLOAD_BYTES } = require('./upload-contract.ts')

const PDF = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const TXT = 'text/plain'
const bytes = text => new TextEncoder().encode(text)

/** A minimal, valid one-page PDF with real text operators and a correct xref table. */
function pdfWith(lines) {
  const content = `BT /F1 12 Tf 14 TL 72 720 Td ${lines.map(line => `(${line}) Tj T*`).join(' ')} ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = body.length
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return bytes(body)
}

const docxWith = (xml, extra = {}) => zipSync({ '[Content_Types].xml': strToU8('<Types/>'),
  'word/document.xml': strToU8(xml), ...extra })
const paragraph = text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

test('a real PDF yields its text', async () => {
  const result = await extractUploadText(pdfWith(['The marketing mix has four elements.', 'Price produces revenue.']), PDF)
  assert.equal(result.status, 'ok')
  assert.match(result.text, /The marketing mix has four elements\./)
  assert.match(result.text, /Price produces revenue\./)
})

test('a multi-page compressed PDF yields every page in order, then its parser is gone', async () => {
  const { deflateSync } = require('node:zlib')
  const pages = 40
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  for (let number = 1; number <= pages; number += 1) {
    const content = `BT /F1 12 Tf 14 TL 72 720 Td (Page ${number}: market segmentation divides buyers.) Tj ET`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + (number - 1) * 2} 0 R ` +
      '/Resources << /Font << /F1 3 0 R >> >> >>',
    { dict: '<< /Length %LENGTH% /Filter /FlateDecode >>', stream: deflateSync(Buffer.from(content)) })
  }
  const report = await parseInIsolation('pdf', pdfFromObjects(objects))
  assert.equal(report.outcome, 'ok')
  assert.equal(report.result.status, 'ok')
  const found = [...report.result.text.matchAll(/Page (\d+):/g)].map(match => Number(match[1]))
  assert.deepEqual(found, Array.from({ length: pages }, (_, index) => index + 1))
  assert.deepEqual(parserLoad(), { active: 0, queued: 0, processes: 0, samplers: 0 })
})

test('a damaged PDF is refused as corrupt, never thrown', async () => {
  assert.deepEqual(await extractUploadText(bytes('%PDF-1.7\n%garbage without objects'), PDF),
    { status: 'rejected', reason: 'corrupt' })
})

test('a DOCX yields paragraph text with entities, tabs and breaks decoded', async () => {
  const xml = `<w:document><w:body>${paragraph('Price &amp; value')}<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t>` +
    `<w:br/><w:t>&#8358;5,000 &lt;fee&gt;</w:t></w:r></w:p></w:body></w:document>`
  const result = await extractUploadText(docxWith(xml), DOCX)
  assert.deepEqual(result, { status: 'ok', text: 'Price & value\nA\tB\n₦5,000 <fee>\n' })
})

test('only word/document.xml is inflated; macros and other parts are ignored', async () => {
  const result = await extractUploadText(docxWith(`<w:document>${paragraph('Notes')}</w:document>`,
    { 'word/vbaProject.bin': new Uint8Array([1, 2, 3]) }), DOCX)
  assert.deepEqual(result, { status: 'ok', text: 'Notes\n' })
})

test('a decompression bomb and a zip that is not a Word document are refused', async () => {
  const bomb = docxWith(`<w:document>${'<w:p/>'.repeat(400_000)}</w:document>`)
  assert.ok(bomb.length < 100_000, 'fixture compresses heavily')
  assert.deepEqual(await extractUploadText(bomb, DOCX), { status: 'rejected', reason: 'too-much-text' })
  assert.deepEqual(await extractUploadText(zipSync({ 'notes.txt': strToU8('hello') }), DOCX),
    { status: 'rejected', reason: 'unsupported-type' })
  assert.deepEqual(await extractUploadText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]), DOCX),
    { status: 'rejected', reason: 'corrupt' })
})

test('legacy .doc and password-protected Office files are told apart', async () => {
  const cfb = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  const legacy = new Uint8Array([...cfb, ...new Array(64).fill(0)])
  const encrypted = new Uint8Array([...cfb, ...Buffer.from('EncryptionInfo', 'utf16le')])
  assert.deepEqual(await extractUploadText(legacy, DOCX), { status: 'rejected', reason: 'unsupported-type' })
  assert.deepEqual(await extractUploadText(encrypted, DOCX), { status: 'rejected', reason: 'encrypted' })
})

test('declared type must match the bytes', async () => {
  const pdf = pdfWith(['Hello'])
  const docx = docxWith(`<w:document>${paragraph('Hi')}</w:document>`)
  assert.equal((await extractUploadText(pdf, TXT)).reason, 'unsupported-type')
  assert.equal((await extractUploadText(docx, TXT)).reason, 'unsupported-type')
  assert.equal((await extractUploadText(docx, PDF)).reason, 'unsupported-type')
  assert.equal((await extractUploadText(bytes('plain words'), PDF)).reason, 'unsupported-type')
  assert.equal((await extractUploadText(pdf, DOCX)).reason, 'unsupported-type')
})

test('size bounds are enforced before parsing', async () => {
  assert.deepEqual(await extractUploadText(new Uint8Array(0), TXT), { status: 'rejected', reason: 'empty' })
  assert.deepEqual(await extractUploadText(new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(65), TXT),
    { status: 'rejected', reason: 'too-large' })
})

test('plain text accepts UTF-8, UTF-16 and Windows-1252, and refuses binary', async () => {
  assert.deepEqual(await extractUploadText(bytes('Naïra notes'), TXT), { status: 'ok', text: 'Naïra notes' })
  const utf16 = new Uint8Array([0xff, 0xfe, ...Buffer.from('Hi there', 'utf16le')])
  assert.deepEqual(await extractUploadText(utf16, TXT), { status: 'ok', text: 'Hi there' })
  assert.deepEqual(await extractUploadText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]), TXT), { status: 'ok', text: 'Café' })
  assert.equal((await extractUploadText(new Uint8Array([0x41, 0x00, 0x42]), TXT)).reason, 'unsupported-type')
  const noisy = new Uint8Array(Array.from({ length: 200 }, (_, index) => index % 3 === 0 ? 0x01 : 0x41))
  assert.equal((await extractUploadText(noisy, TXT)).reason, 'unsupported-type')
  assert.deepEqual(await extractUploadText(bytes('   \n\t '), TXT), { status: 'rejected', reason: 'empty' })
})

test('malformed Word XML inside a real archive is refused as corrupt, not guessed at', async () => {
  for (const xml of ['<w:document><w:p><w:r><w:t>Unclosed', '<w:document><w:p></w:r></w:p></w:document>',
    '<w:document><w:p><w:r><w:t>a < b</w:t></w:r></w:p></w:document>']) {
    assert.deepEqual(await extractUploadText(docxWith(xml), DOCX), { status: 'rejected', reason: 'corrupt' }, xml)
  }
})
