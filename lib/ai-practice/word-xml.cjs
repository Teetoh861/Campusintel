// lib/ai-practice/word-xml.cjs — Single-pass WordprocessingML reader that refuses malformed XML.
// Plain CommonJS so the extraction worker can load it outside the Next.js bundle.
// Every scan moves strictly forward, so time is linear in the input however the markup is broken.
'use strict'

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function safeCodePoint(code, fallback) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback
}

/** Decode the five predefined entities and numeric references; anything else is kept as written. */
function decodeXmlText(value) {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (match, entity) => {
    if (entity.startsWith('#x')) return safeCodePoint(Number.parseInt(entity.slice(2), 16), match)
    if (entity.startsWith('#')) return safeCodePoint(Number.parseInt(entity.slice(1), 10), match)
    return XML_ENTITIES[entity] ?? match
  })
}

const isSpace = code => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
// Characters that end a tag or attribute name; all are ASCII.
const NAME_STOPS = new Uint8Array(128)
for (const char of ' \t\n\r/>=<"\'&!?') NAME_STOPS[char.charCodeAt(0)] = 1
const isNameStop = code => code < 128 && NAME_STOPS[code] === 1
const LT = 0x3c, GT = 0x3e, SLASH = 0x2f, EQUALS = 0x3d, BANG = 0x21, DOUBLE = 0x22, SINGLE = 0x27

class MalformedXml extends Error {}
class TooMuchText extends Error {}

/**
 * Read paragraph text from WordprocessingML: w:t text, w:tab, w:br and w:cr, and a newline per paragraph.
 * Returns { status: 'ok', text }, { status: 'malformed' } for anything that is not well-formed XML
 * (unclosed or mismatched tags, stray '<', unquoted attributes, DOCTYPE), or { status: 'too-much-text' }
 * as soon as the text passes maxChars.
 */
function wordXmlToText(xml, maxChars = Infinity) {
  const parts = []
  const stack = []
  let length = 0
  let sawRoot = false
  let index = xml.charCodeAt(0) === 0xfeff ? 1 : 0
  const end = xml.length

  const emit = text => {
    length += text.length
    if (length > maxChars) throw new TooMuchText()
    parts.push(text)
  }
  const readName = from => {
    let cursor = from
    while (cursor < end && !isNameStop(xml.charCodeAt(cursor))) cursor += 1
    if (cursor === from) throw new MalformedXml()
    return cursor
  }
  const skipSpace = from => {
    let cursor = from
    while (cursor < end && isSpace(xml.charCodeAt(cursor))) cursor += 1
    return cursor
  }
  const closing = (marker, from) => {
    const found = xml.indexOf(marker, from)
    if (found === -1) throw new MalformedXml()
    return found + marker.length
  }
  // Character data between from and to; CDATA content is taken literally, everything else is entity-decoded.
  const characterData = (from, to, decoded) => {
    if (stack.length > 0 && stack[stack.length - 1] === 'w:t') {
      const raw = xml.slice(from, to)
      emit(decoded ? decodeXmlText(raw) : raw)
      return
    }
    // Only whitespace may sit outside the root element. Outside w:t only literal tabs and newlines survive,
    // as they always have.
    let kept = ''
    for (let cursor = from; cursor < to; cursor += 1) {
      const code = xml.charCodeAt(cursor)
      if (code === 0x09 || code === 0x0a) kept += xml[cursor]
      else if (stack.length === 0 && !isSpace(code)) throw new MalformedXml()
    }
    if (kept) emit(kept)
  }

  try {
    while (index < end) {
      const open = xml.indexOf('<', index)
      const textEnd = open === -1 ? end : open
      if (textEnd > index) characterData(index, textEnd, true)
      if (open === -1) break
      index = open

      if (xml.startsWith('<!--', index)) { index = closing('-->', index + 4); continue }
      if (xml.startsWith('<?', index)) { index = closing('?>', index + 2); continue }
      if (xml.startsWith('<![CDATA[', index)) {
        if (stack.length === 0) throw new MalformedXml()
        const after = closing(']]>', index + 9)
        characterData(index + 9, after - 3, false)
        index = after
        continue
      }
      // DOCTYPE and other declarations: Word never writes them, and entity declarations are refused outright.
      if (xml.charCodeAt(index + 1) === BANG) throw new MalformedXml()

      if (xml.charCodeAt(index + 1) === SLASH) {
        const nameEnd = readName(index + 2)
        const name = xml.slice(index + 2, nameEnd)
        const close = skipSpace(nameEnd)
        if (xml.charCodeAt(close) !== GT || stack.pop() !== name) throw new MalformedXml()
        if (name === 'w:p') emit('\n')
        index = close + 1
        continue
      }

      const nameEnd = readName(index + 1)
      const name = xml.slice(index + 1, nameEnd)
      let cursor = nameEnd
      let selfClosing = false
      for (;;) {
        const afterSpace = skipSpace(cursor)
        const code = xml.charCodeAt(afterSpace)
        if (code === GT) { cursor = afterSpace + 1; break }
        if (code === SLASH && xml.charCodeAt(afterSpace + 1) === GT) { cursor = afterSpace + 2; selfClosing = true; break }
        // An attribute must be separated from what precedes it by whitespace.
        if (afterSpace === cursor) throw new MalformedXml()
        cursor = skipSpace(readName(afterSpace))
        if (xml.charCodeAt(cursor) !== EQUALS) throw new MalformedXml()
        cursor = skipSpace(cursor + 1)
        const quote = xml.charCodeAt(cursor)
        if (quote !== DOUBLE && quote !== SINGLE) throw new MalformedXml()
        cursor += 1
        while (cursor < end && xml.charCodeAt(cursor) !== quote) {
          if (xml.charCodeAt(cursor) === LT) throw new MalformedXml()
          cursor += 1
        }
        if (cursor >= end) throw new MalformedXml()
        cursor += 1
      }
      // A second top-level element is not a document.
      if (stack.length === 0 && sawRoot) throw new MalformedXml()
      sawRoot = true
      if (!selfClosing) stack.push(name)
      else if (name === 'w:tab') emit('\t')
      else if (name === 'w:br' || name === 'w:cr') emit('\n')
      index = cursor
    }
    if (!sawRoot || stack.length > 0) throw new MalformedXml()
  } catch (error) {
    if (error instanceof MalformedXml) return { status: 'malformed' }
    if (error instanceof TooMuchText) return { status: 'too-much-text' }
    throw error
  }
  return { status: 'ok', text: parts.join('') }
}

module.exports = { wordXmlToText }
