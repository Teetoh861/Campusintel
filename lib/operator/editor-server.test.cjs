// lib/operator/editor-server.test.cjs — Server mutation dispatch, payload checks, and conflict reporting.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')

async function fixture(run) {
  const oldLoad = Module._load
  const oldTs = Module._extensions['.ts']
  const loaded = []
  try {
    Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) { return name === 'server-only' ? {} : oldLoad.call(this, name, ...args) }
    const file = require.resolve('./editor-server.ts')
    loaded.push(file)
    delete require.cache[file]
    await run(require(file))
  } finally {
    Module._load = oldLoad
    if (oldTs) Module._extensions['.ts'] = oldTs
    else delete Module._extensions['.ts']
    for (const file of loaded) delete require.cache[file]
  }
}

const COURSE = '40000000-0000-4000-8000-000000000001'
const ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const THEORY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

test('server dispatch creates every family with validated payloads and server-owned CBT identity', async () => fixture(async editor => {
  const calls = []
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: ITEM, error: null } } }
  const content = [
    ['course_overview', { title: 'Overview', body: 'Body' }],
    ['note', { title: 'Note', body: 'Body' }],
    ['cbt_question', { prompt: 'Choose', options: ['A', 'B'], correctOption: 0 }],
    ['theory_question', { prompt: 'Explain' }],
    ['model_answer', { body: 'Answer' }],
    ['rubric', { body: 'Rubric' }],
  ]
  for (const [kind, payload] of content) {
    const result = await editor.writeOperatorContent(client, { action: 'create', courseId: COURSE,
      kind, payload, ...(kind === 'model_answer' || kind === 'rubric' ? { parentItemId: THEORY } : {}) })
    assert.deepEqual(result, { status: 'ok', data: { itemId: ITEM } })
  }
  assert.equal(calls.length, 6)
  assert.ok(calls.every(call => call.name === 'create_managed_content' && call.args.p_course_id === COURSE))
  assert.match(calls[2].args.p_question_id, /^[0-9a-f-]{36}$/)
  assert.equal(calls[1].args.p_question_id, null)
  assert.equal(calls[4].args.p_parent_item_id, THEORY)
  assert.equal((await editor.writeOperatorContent(client, { action: 'create', courseId: COURSE,
    kind: 'note', payload: { title: '', body: 'Bad' } })).status, 'invalid')
  assert.equal((await editor.writeOperatorContent(client, { action: 'create', courseId: COURSE,
    kind: 'rubric', payload: { body: 'Missing parent' } })).status, 'invalid')
  assert.equal(calls.length, 6)
}))

test('oversized managed payloads fail before an operator mutation RPC', async () => fixture(async editor => {
  const calls = []
  const client = { rpc: async name => { calls.push(name); return { data: ITEM, error: null } } }
  const result = await editor.writeOperatorContent(client, { action: 'create', courseId: COURSE,
    kind: 'note', payload: { title: 'T', body: '😀'.repeat(65530) } })
  assert.equal(result.status, 'invalid')
  assert.match(result.message, /262,144-byte limit/)
  assert.deepEqual(calls, [])
}))

test('stale mutation is reported as a conflict without retrying', async () => fixture(async editor => {
  const calls = []
  const client = { rpc: async (name, args) => {
    calls.push({ name, args })
    if (name === 'get_managed_content_history') return { data: {
      item: { id: ITEM, course_id: COURSE, kind: 'note', question_id: null, source_key: null,
        parent_item_id: null, current_revision: 1, approved_revision: null, published_revision: null,
        published_parent_revision: null, lock_version: 2, created_by: THEORY,
        created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' },
      revisions: [], reviews: [], publications: [],
    }, error: null }
    return { data: null, error: { code: '40001' } }
  } }
  const result = await editor.writeOperatorContent(client, { action: 'revise', itemId: ITEM,
    expectedLockVersion: 1, payload: { title: 'Note', body: 'Changed' } })
  assert.equal(result.status, 'conflict')
  assert.deepEqual(calls.map(call => call.name), ['get_managed_content_history', 'revise_managed_content'])
  assert.equal(calls[1].args.p_expected_lock_version, 1)
}))
