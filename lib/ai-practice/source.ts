// lib/ai-practice/source.ts — Normalize validated extracted text into bounded, addressable passages.
// Extraction (PDF/DOCX/TXT) happens before this module; it only ever sees plain text.
import { createHash } from 'node:crypto'
import { AI_PRACTICE_LIMITS } from './contract'

export type SourcePassage = { id: string; start: number; end: number; text: string }
export type PreparedSource = {
  text: string
  sha256: string
  charCount: number
  wordCount: number
  passages: SourcePassage[]
}
export type PreparedSourceResult =
  | { status: 'ok'; source: PreparedSource }
  | { status: 'empty' | 'too-short' | 'too-large' }

type Range = { start: number; end: number }

// C0/C1 controls except tab and newline, plus zero-width and BOM characters left behind by extractors.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‍⁠﻿]/g

/**
 * Canonical student text. Angle brackets become their full-width forms so uploaded text can never
 * close or open the prompt's own delimiters; the model sees and quotes exactly this text.
 */
export function normalizeSourceText(raw: string): string {
  return raw.normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(/</g, '＜').replace(/>/g, '＞')
    .split('\n').map(line => line.replace(/[\t  ]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function paragraphRanges(text: string): Range[] {
  const ranges: Range[] = []
  const separator = /\n{2,}/g
  let start = 0
  for (let match = separator.exec(text); match !== null; match = separator.exec(text)) {
    if (match.index > start) ranges.push({ start, end: match.index })
    start = match.index + match[0].length
  }
  if (text.length > start) ranges.push({ start, end: text.length })
  return ranges
}

/** Split an over-long paragraph at the last sentence end, else the last space, inside the window. */
function splitLong(text: string, range: Range, max: number): Range[] {
  const pieces: Range[] = []
  let start = range.start
  while (range.end - start > max) {
    const window = text.slice(start, start + max)
    let cut = -1
    for (const match of window.matchAll(/[.!?]["')\]]?\s/g)) cut = match.index + match[0].length
    if (cut <= 0) cut = window.lastIndexOf(' ') + 1
    if (cut <= 0) cut = max
    let end = start + cut
    while (end > start && /\s/.test(text[end - 1]!)) end -= 1
    pieces.push({ start, end })
    start += cut
    while (start < range.end && /\s/.test(text[start]!)) start += 1
  }
  if (range.end > start) pieces.push({ start, end: range.end })
  return pieces
}

/** Merge neighbouring short paragraphs so passages carry enough context to ground a question. */
function mergeShort(ranges: Range[], max: number): Range[] {
  const merged: Range[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.end - last.start <= max) last.end = range.end
    else merged.push({ ...range })
  }
  return merged
}

/** Prepare student text, rejecting empty, too-short and oversized material instead of truncating it. */
export function prepareSource(raw: string): PreparedSourceResult {
  const text = normalizeSourceText(raw)
  if (text.length === 0) return { status: 'empty' }
  if (text.length > AI_PRACTICE_LIMITS.maxSourceChars) return { status: 'too-large' }
  const wordCount = text.split(/\s+/).filter(Boolean).length
  if (wordCount < AI_PRACTICE_LIMITS.minSourceWords) return { status: 'too-short' }
  const max = AI_PRACTICE_LIMITS.maxPassageChars
  const ranges = mergeShort(paragraphRanges(text).flatMap(range => splitLong(text, range, max)), max)
  if (ranges.length > AI_PRACTICE_LIMITS.maxPassages) return { status: 'too-large' }
  const passages = ranges.map((range, index) => ({
    id: `P${index + 1}`, start: range.start, end: range.end, text: text.slice(range.start, range.end),
  }))
  return { status: 'ok', source: {
    text, sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    charCount: text.length, wordCount, passages,
  } }
}
