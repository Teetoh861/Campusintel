// scripts/managed-content/study-guides/payload.test.cjs — What an import stores from the guide text: "What you must
// know" starts with a capital letter and is otherwise the source text; the assessment lines drop the guide.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { SOURCE_DIR, assessmentLines, guideTopicPayload, readGuide } = require('../study-guides.cjs')
const { plainInline } = require('./parse.cjs')

const QUESTION = '11111111-1111-4111-8111-111111111111'

test('"What you must know" gains a capital first letter and nothing else, in all 183 topics', () => {
  let topics = 0
  for (const code of fs.readdirSync(SOURCE_DIR).sort()) {
    for (const topic of readGuide(code).topics) {
      const source = plainInline(topic.mustKnow)
      const payload = guideTopicPayload(topic, QUESTION, [])
      const [first, ...rest] = Array.from(source)
      assert.equal(payload.body, first.toUpperCase() + rest.join(''), `${code} topic ${topic.number}`)
      assert.equal(plainInline(payload.mustKnow), payload.body)
      assert.deepEqual(payload.mustKnow.map(span => ({ ...span, text: undefined })), topic.mustKnow.map(span => ({ ...span, text: undefined })),
        `${code} topic ${topic.number}: bold and italic are kept`)
      assert.match(payload.body, /^\p{Lu}/u)
      topics++
    }
  }
  assert.equal(topics, 183)
})

test('the assessment lines say every topic is examinable without mentioning the guide', () => {
  const span = text => [{ text }]
  assert.deepEqual(assessmentLines('LAG-ACS209', [span('Every topic in this guide is examinable. Read all eight, and work through every worked example with a calculator.')]),
    ['Every topic is examinable. Work through every worked example with a calculator.'])
  assert.deepEqual(assessmentLines('LAG-ACS213', [span('Every topic in this guide is examinable. Read all ten, and work through every worked example with a calculator.')]),
    ['Every topic is examinable. Work through every worked example with a calculator.'])
  assert.deepEqual(assessmentLines('GST111', [span('Every topic in this guide is examinable. Read all fifteen.')]), ['Every topic is examinable.'])
  assert.throws(() => assessmentLines('GST111', [span('Use this guide every week.')]), /mentions the guide/)
  for (const code of fs.readdirSync(SOURCE_DIR)) {
    for (const line of assessmentLines(code, readGuide(code).cover.assessment)) assert.doesNotMatch(line, /\bguide\b/i, code)
  }
})
