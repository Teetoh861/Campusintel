// lib/practice/topics.test.cjs — Practice by topic (owner's task of 29 Oct): the course's topic list keeps the database's
// order, each row says its size before practice and its progress after (never both), and anything malformed fails
// closed to no list (Exam mode only) or no progress (counts only), never to guessed figures.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { nextTopicAfter, practiceTopicsFrom, readPracticeTopics, readTopicProgress, topicLine, topicProgressFrom, topicRowsOf }
  = require('./topics.ts')

const COURSE = '40000000-0000-4000-8000-000000000008'
const row = (ordinal, topic, bank_size) => ({ ordinal, topic, bank_size })

test('the topic list keeps the database order; a malformed or duplicated list is no list', () => {
  assert.deepEqual(practiceTopicsFrom([row(2, 'The Sounds of English', 20), row(1, 'Listening Skills', 20)]),
    [{ topic: 'Listening Skills', bankSize: 20 }, { topic: 'The Sounds of English', bankSize: 20 }])
  assert.deepEqual(practiceTopicsFrom([]), [], 'a course with no topics offers Exam mode only')
  for (const bad of [null, {}, [row(1, '', 3)], [row(1, 'A', 0)], [{ ...row(1, 'A', 3), prompt: 'leak' }],
    [row(1, 'A', 3), row(2, 'A', 4)]]) {
    assert.equal(practiceTopicsFrom(bad), null, JSON.stringify(bad))
  }
})

test('one line per topic: "12 questions" before practice, "8 of 12 questions practised · Last score 6/8" after', () => {
  assert.equal(topicLine(12, undefined), '12 questions')
  assert.equal(topicLine(1, undefined), '1 question')
  assert.equal(topicLine(12, { practised: 0, lastScore: null }), '12 questions')
  assert.equal(topicLine(12, { practised: 8, lastScore: { score: 6, total: 8 } }), '8 of 12 questions practised · Last score 6/8')
  assert.equal(topicLine(12, { practised: 3, lastScore: null }), '3 of 12 questions practised', 'practised in an exam only')
  const rows = topicRowsOf([{ topic: 'A', bankSize: 12 }, { topic: 'B', bankSize: 5 }],
    new Map([['A', { practised: 8, lastScore: { score: 6, total: 8 } }]]))
  assert.deepEqual(rows.map(entry => [entry.number, entry.topic, entry.line]),
    [[1, 'A', '8 of 12 questions practised · Last score 6/8'], [2, 'B', '5 questions']])
  assert.deepEqual(topicRowsOf([{ topic: 'A', bankSize: 12 }], null).map(entry => entry.line), ['12 questions'],
    'progress that cannot be read leaves the count')
})

test('progress maps the database figures exactly; inconsistent figures are no progress', () => {
  const ok = topics => ({ state: 'ok', topics })
  assert.deepEqual(topicProgressFrom(ok([{ topic: 'A', practised: 8, score: 6, total: 8 },
    { topic: 'B', practised: 2, score: null, total: null }])),
  new Map([['A', { practised: 8, lastScore: { score: 6, total: 8 } }], ['B', { practised: 2, lastScore: null }]]))
  assert.deepEqual(topicProgressFrom(ok([])), new Map())
  for (const bad of [{ state: 'signed-out' }, null, ok([{ topic: 'A', practised: 1, score: 2, total: 1 }]),
    ok([{ topic: 'A', practised: 1, score: 1, total: null }]),
    ok([{ topic: 'A', practised: 1, score: null, total: null }, { topic: 'A', practised: 2, score: null, total: null }])]) {
    assert.equal(topicProgressFrom(bad), null, JSON.stringify(bad))
  }
})

test('Next topic is the following one in the course order, none after the last or for an unlisted topic', () => {
  const topics = [{ topic: 'A', bankSize: 1 }, { topic: 'B', bankSize: 1 }]
  assert.equal(nextTopicAfter(topics, 'A'), 'B')
  assert.equal(nextTopicAfter(topics, 'B'), null)
  assert.equal(nextTopicAfter(topics, 'Gone'), null)
})

test('the reads use the count-only boundary and the verified session, and fail closed', async () => {
  const calls = []
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: [row(1, 'Listening Skills', 20)], error: null } } }
  assert.deepEqual(await readPracticeTopics(client, COURSE, ['Listening Skills']), [{ topic: 'Listening Skills', bankSize: 20 }])
  assert.deepEqual(calls, [['published_cbt_topics', { p_course_id: COURSE, p_sections: ['Listening Skills'] }]])
  assert.equal(await readPracticeTopics({ rpc: async () => ({ data: null, error: { code: 'CI403' } }) }, COURSE, []), null,
    'a locked course has no topic list')
  assert.equal(await readPracticeTopics({ rpc: async () => { throw new Error('offline') } }, COURSE, []), null)
  const env = { progress: async courseId => { calls.push(['progress', courseId]); return { data: { state: 'ok', topics: [] }, error: null } } }
  assert.deepEqual(await readTopicProgress('session-1', COURSE, env), new Map())
  assert.deepEqual(calls.at(-1), ['progress', COURSE])
  assert.equal(await readTopicProgress('session-1', COURSE, { progress: async () => ({ data: null, error: {} }) }), null)
  assert.equal(await readTopicProgress('session-1', COURSE, { progress: async () => { throw new Error('offline') } }), null)
})
