// lib/ai-practice/campus-bot-usage.test.cjs — Reading what is left of a student's Campus Bot limits, fail-closed.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readCampusBotUsage } = require('./campus-bot-usage.ts')

const client = (data, error = null) => ({ calls: [], async rpc(fn, args) { this.calls.push([fn, args]); return { data, error } } })
const window = (extra = {}) => ({ limit: 350000, used: 60000, in_flight: 0, left: 290000,
  resets_at: '2026-11-03T14:00:00.000Z', ...extra })

test('token mode: both windows with their stored reset times, the next set\'s cost and whether it can start', async () => {
  const reader = client({ state: 'tokens', tier: 'standard', session: window(),
    week: window({ limit: 700000, left: 640000, resets_at: '2026-11-09T09:00:00.000Z' }), next_set_max: 60000, can_start: true })
  assert.deepEqual(await readCampusBotUsage(reader), { state: 'tokens', tier: 'standard',
    session: { limit: 350000, used: 60000, inFlight: 0, left: 290000, resetsAt: '2026-11-03T14:00:00.000Z' },
    week: { limit: 700000, used: 60000, inFlight: 0, left: 640000, resetsAt: '2026-11-09T09:00:00.000Z' },
    nextSetMax: 60000, canStart: true })
  assert.deepEqual(reader.calls, [['get_my_campus_bot_usage', undefined]])
})

test('a window not yet opened has no reset time, and a set that overran leaves it below zero', async () => {
  const usage = await readCampusBotUsage(client({ state: 'tokens', tier: 'plus',
    session: window({ limit: 700000, used: 712000, left: -12000 }), week: window({ resets_at: null, used: 0, left: 350000 }),
    next_set_max: 60000, can_start: false }))
  assert.equal(usage.session.left, -12000)
  assert.equal(usage.week.resetsAt, null)
  assert.equal(usage.canStart, false)
})

test('counted sets and no grant are passed through; errors and unreadable answers are null', async () => {
  assert.deepEqual(await readCampusBotUsage(client({ state: 'units' })), { state: 'units' })
  assert.deepEqual(await readCampusBotUsage(client({ state: 'not-entitled' })), { state: 'not-entitled' })
  assert.equal(await readCampusBotUsage(client(null, { code: '42501' })), null)
  assert.equal(await readCampusBotUsage(client({ state: 'tokens', tier: 'gold' })), null)
  assert.equal(await readCampusBotUsage(client({ state: 'units', extra: 1 })), null)
})
