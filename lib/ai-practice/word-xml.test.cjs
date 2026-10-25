// lib/ai-practice/word-xml.test.cjs — The linear Word XML reader: parity on valid XML, refusal and speed on malformed XML.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { wordXmlToText } = require('./word-xml.cjs')
// CPU-bound scans of up to 16 MB; generous for a loaded machine, and only reached when something is stuck.
const HARD_TIMEOUT = { timeout: 60_000 }
// A linear scan examines each character a small, fixed number of times (4.5 for the busiest shape below).
const MAX_WORK_PER_CHARACTER = 6

/** The regex reader this replaced, kept verbatim as the oracle for well-formed documents only. */
function legacyWordXmlToText(xml) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  const point = (code, fallback) => Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback
  const decode = value => value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (match, entity) => {
    if (entity.startsWith('#x')) return point(Number.parseInt(entity.slice(2), 16), match)
    if (entity.startsWith('#')) return point(Number.parseInt(entity.slice(1), 10), match)
    return entities[entity] ?? match
  })
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, (_, text) => `\u0000${text}\u0000`)
    .replace(/<[^>]+>/g, '')
    .split('\u0000').map((part, index) => index % 2 === 1 ? decode(part) : part.replace(/[^\n\t]/g, ''))
    .join('')
}

const ok = text => ({ status: 'ok', text })

test('Word XML reading ignores markup and keeps only text', HARD_TIMEOUT, () => {
  assert.deepEqual(wordXmlToText('<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Bold</w:t></w:r></w:p>'), ok('Bold\n'))
  // A lone paragraph is its own root; a fragment with two top-level paragraphs is not a document.
  assert.deepEqual(wordXmlToText('<w:document><w:p><w:r><w:instrText>HYPERLINK "x"</w:instrText><w:t>&#x41;&#0;&bogus;</w:t>' +
    '</w:r></w:p></w:document>'), ok('A&#0;&bogus;\n'))
})

/** Seeded generator of well-formed WordprocessingML shaped like what Word writes. */
function randomDocument(seed) {
  let state = seed
  const next = limit => { state = (state * 1103515245 + 12345) >>> 0; return (state >>> 16) % limit }
  const words = ['Price', 'value & cost', '<fee>', '"quoted"', "it's", '₦5,000', 'naïve', 'A\tB', 'line\nbreak', '']
  const text = () => words[next(words.length)].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, next(2) ? '&quot;' : '"') + (next(4) === 0 ? '&#8358;&#x41;' : '')
  const run = () => {
    const pieces = []
    for (let count = next(4) + 1; count > 0; count -= 1) {
      const kind = next(9)
      if (kind < 4) pieces.push(next(2) ? `<w:t xml:space="preserve">${text()}</w:t>` : `<w:t>${text()}</w:t>`)
      else if (kind === 4) pieces.push(next(2) ? '<w:tab/>' : '<w:tab w:val="left" />')
      else if (kind === 5) pieces.push(next(2) ? '<w:br/>' : '<w:br w:type="page"/>')
      else if (kind === 6) pieces.push('<w:cr/>')
      else if (kind === 7) pieces.push('<w:instrText xml:space="preserve"> PAGE </w:instrText>')
      else pieces.push('<w:rPr><w:b/><w:i w:val="0"/><w:sz w:val="24"/></w:rPr>')
    }
    return `<w:r>${pieces.join('')}</w:r>`
  }
  const paragraph = () => {
    const props = next(3) === 0 ? '<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:jc w:val="both"/></w:pPr>' : ''
    const runs = Array.from({ length: next(4) }, () => (next(5) === 0 ? '<w:proofErr w:type="spellStart"/>' : '') + run())
    const marks = next(4) === 0 ? '<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>' : ''
    return next(6) === 0 ? '<w:p/>' : `<w:p w:rsidR="00A1">${props}${marks}${runs.join('')}</w:p>`
  }
  const separator = () => ['', '', '\n', '\r\n  ', '\t'][next(5)]
  const body = Array.from({ length: next(12) + 1 }, () => separator() + paragraph()).join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}<!-- generated --><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
}

test('valid documents read exactly as the regex reader read them (500 seeded documents)', HARD_TIMEOUT, () => {
  for (let seed = 1; seed <= 500; seed += 1) {
    const xml = randomDocument(seed)
    assert.deepEqual(wordXmlToText(xml), ok(legacyWordXmlToText(xml)), `seed ${seed}`)
  }
})

test('malformed XML is refused explicitly', HARD_TIMEOUT, () => {
  const cases = {
    'unclosed root': '<w:document><w:body>',
    'unclosed w:t': '<w:document><w:p><w:r><w:t>Text',
    'mismatched end tag': '<w:document><w:p></w:r></w:document>',
    'end tag with no start': '</w:p>',
    'stray <': '<w:document><w:p><w:r><w:t>a < b</w:t></w:r></w:p></w:document>',
    'repeated unmatched <': `<w:document><w:t ${'<'.repeat(1000)}`,
    'unquoted attribute': '<w:document w:a=1></w:document>',
    'attribute without value': '<w:document w:a></w:document>',
    'attributes run together': '<w:document a="1"b="2"></w:document>',
    '< inside an attribute': '<w:document a="<"></w:document>',
    'unterminated attribute': '<w:document a="never',
    'unterminated comment': '<w:document><!-- never',
    'unterminated CDATA': '<w:document><![CDATA[ never',
    'unterminated declaration': '<?xml version="1.0"',
    'DOCTYPE with entities': '<!DOCTYPE d [<!ENTITY e "x">]><w:document>&e;</w:document>',
    'text outside the root': 'stray<w:document/>',
    'second root': '<w:document/><w:document/>',
    'no root at all': '   ',
    'empty tag name': '<></>',
  }
  for (const [name, xml] of Object.entries(cases)) assert.deepEqual(wordXmlToText(xml), { status: 'malformed' }, name)
})

test('text beyond the cap stops the scan at once', HARD_TIMEOUT, () => {
  const xml = `<w:document>${'<w:p><w:r><w:t>abcdefghij</w:t></w:r></w:p>'.repeat(1000)}</w:document>`
  assert.deepEqual(wordXmlToText(xml, 5_000), { status: 'too-much-text' })
  assert.equal(wordXmlToText(xml, 11_000).status, 'ok')
})

/**
 * The string as the reader sees it, counting every character it examines: one per charCodeAt or index, the span an
 * indexOf searches, the length a startsWith compares and a slice copies. The count is the reader's work, the same
 * on any machine under any load; a quadratic reader examines about n^2 characters. Missing methods throw, so a
 * reader rewritten around other string operations fails here instead of going unmeasured.
 */
function counted(text) {
  const work = { characters: 0 }
  // Only indexing reaches the prototype; the methods are own properties, so the scan stays fast.
  const indexed = new Proxy({}, { get: (target, key) => {
    if (typeof key === 'string' && /^\d+$/.test(key)) { work.characters += 1; return text[key] }
    return undefined
  } })
  const xml = Object.assign(Object.create(indexed), {
    length: text.length,
    charCodeAt: index => { work.characters += 1; return text.charCodeAt(index) },
    indexOf: (marker, from) => {
      const found = text.indexOf(marker, from)
      work.characters += found === -1 ? text.length - from : found - from + marker.length
      return found
    },
    startsWith: (marker, from) => { work.characters += marker.length; return text.startsWith(marker, from) },
    slice: (from, to) => { const part = text.slice(from, to); work.characters += part.length; return part },
  })
  return { xml, work }
}

/** Characters examined per input character. */
function workPerCharacter(text) {
  const { xml, work } = counted(text)
  assert.equal(wordXmlToText(xml).status, 'malformed')
  return work.characters / text.length
}

test('malformed input of 16 MB, the inflated-part cap, is answered in linear time', HARD_TIMEOUT, () => {
  // Each shape is refused only at the end, except open tags, refused at the first stray '<'; a quadratic reader would
  // take hours.
  const size = 16 * 1024 * 1024
  const shapes = {
    'open tags with no >': () => '<w:document>' + '<w:t a="1" '.repeat(size / 11),
    'unterminated attribute': () => '<w:document a="' + 'x'.repeat(size),
    'unterminated comment': () => '<w:document><!--' + '<<'.repeat(size / 2),
    'valid body, root never closed': () => '<w:document>' + '<w:p><w:r><w:t>words</w:t></w:r></w:p>'.repeat(size / 40),
  }
  for (const [name, make] of Object.entries(shapes)) {
    const large = make()
    const small = large.slice(0, large.length / 8)
    assert.equal(wordXmlToText(large).status, 'malformed', name)
    // Linear: a few characters examined per input character at both sizes. Quadratic would be about n/2 per
    // character, millions here, and eight times more for the larger input.
    const [smallWork, largeWork] = [workPerCharacter(small), workPerCharacter(large)]
    assert.ok(largeWork <= MAX_WORK_PER_CHARACTER, `${name}: ${largeWork.toFixed(2)} characters examined per character`)
    assert.ok(largeWork <= smallWork * 1.01 + 0.01, `${name}: ${smallWork.toFixed(3)} -> ${largeWork.toFixed(3)} per character`)
  }
})
