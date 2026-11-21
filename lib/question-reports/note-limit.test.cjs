// lib/question-reports/note-limit.test.cjs — The report note limit is 1000 Unicode code points on the client and in the schema.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const limit = require('./note-limit.ts')
const { questionReportInput, REPORT_NOTE_MAX_CHARACTERS } = require('./input.ts')

const samples = [
  ['1000 ASCII', 'x'.repeat(1000), true],
  ['1001 ASCII', 'x'.repeat(1001), false],
  ['1000 emoji', '😀'.repeat(1000), true],
  ['1001 emoji', '😀'.repeat(1001), false],
  ['mixed BMP and astral at the limit', 'a😀'.repeat(500), true],
  ['mixed BMP and astral over the limit', 'a😀'.repeat(500) + 'b', false],
  ['combining marks count per code point', 'é'.repeat(500), true],
  ['combining marks over the limit', 'é'.repeat(500) + '́', false],
]

test('the schema and the client share one owner for the limit', () => {
  assert.equal(REPORT_NOTE_MAX_CHARACTERS, 1000)
  assert.equal(limit.REPORT_NOTE_MAX_CHARACTERS, REPORT_NOTE_MAX_CHARACTERS)
})

test('length, acceptance and clamping count code points, never UTF-16 units', () => {
  const input = { courseId: randomUUID(), itemId: randomUUID(), revision: 1 }
  for (const [name, value, fits] of samples) {
    assert.equal(limit.noteWithinLimit(value), fits, name)
    assert.equal(questionReportInput.safeParse({ ...input, note: value }).success, fits, `schema agrees: ${name}`)
    assert.equal(limit.noteLength(value) <= 1000, fits, name)
    const clamped = limit.clampNote(value)
    assert.equal(limit.noteLength(clamped), Math.min(limit.noteLength(value), 1000), `clamp: ${name}`)
    assert.ok(limit.noteWithinLimit(clamped))
    if (fits) assert.equal(clamped, value, `a fitting note is returned untouched: ${name}`)
  }
  assert.equal(limit.noteLength('😀'.repeat(1000)), 1000)
  assert.equal('😀'.repeat(1000).length, 2000, 'UTF-16 would have counted twice')
  assert.equal(limit.clampNote('😀'.repeat(1001)), '😀'.repeat(1000))
  assert.equal(limit.clampNote('a😀'.repeat(600)), 'a😀'.repeat(500), 'clamping stops on a code point boundary')
  for (const value of ['😀'.repeat(1001), 'x'.repeat(999) + '😀😀']) {
    const clamped = limit.clampNote(value)
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(clamped), 'no lone surrogate after clamping')
  }
})
