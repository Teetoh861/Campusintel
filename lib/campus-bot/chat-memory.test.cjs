const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fitChatPrompt, promptTokenBound } = require('./model-call.ts')
const { recentTurns } = require('./ask.ts')
const { capacityReport } = require('../../scripts/campus-bot/chat-capacity.cjs')

test('fitting gives up the oldest messages before any notes, then notes only with no history left', () => {
  const notes = { passages: [{ text: 'a'.repeat(400) }, { text: 'b'.repeat(400) }] }
  const turns = ['oldest '.repeat(20), 'middle '.repeat(20), 'newest '.repeat(20)]
  const build = (n, t) => ({ system: 'rules', user: n.passages.map(p => p.text).join('\n') + t.join('\n'), outputSchema: {} })
  const limits = { model: 'claude-haiku-5-5', maxInputTokens: promptTokenBound(build(notes, turns.slice(1))), maxOutputTokens: 1500 }
  const fitted = fitChatPrompt(notes, turns, build, limits)
  assert.deepEqual(fitted.turns, turns.slice(1))
  assert.deepEqual(fitted.notes, notes)
  const small = { ...limits, maxInputTokens: promptTokenBound(build({ passages: notes.passages.slice(0, 1) }, [])) }
  const clipped = fitChatPrompt(notes, turns, build, small)
  assert.deepEqual(clipped.turns, [])
  assert.deepEqual(clipped.notes.passages, notes.passages.slice(0, 1))
  assert.equal(fitChatPrompt({ passages: [{ text: 'x'.repeat(5000) }] }, turns, build, small), null)
})

test('the default allowance stays six; a server-admitted Plus or tester allowance keeps twelve', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ role: 'student', text: `Message ${i}` }))
  assert.deepEqual(recentTurns(history).map(t => t.text), history.slice(-6).map(t => t.text))
  assert.deepEqual(recentTurns(history, 12).map(t => t.text), history.slice(-12).map(t => t.text))
})

test('every currently published topic keeps every lesson at the owner ceiling; history yields first', () => {
  const report = capacityReport()
  assert.equal(report.topics, 197)
  assert.equal(report.chosenRead, 18000)
  assert.equal(report.written, 1500)
  assert.equal(report.haikuReservation, 25500)
  assert.deepEqual(report.notesLostAt18000, [])
  assert.ok(report.topicsWithShorterMemory.length > 0, 'the ceiling is enforced by shortening memory')
})
