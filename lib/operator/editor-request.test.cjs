// lib/operator/editor-request.test.cjs — Same-origin editor input and family payload validation.
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
    Module._load = function(name, ...args) {
      if (name === 'server-only') return {}
      if (name === '@/lib/auth/config' || (name === './config' && args[0]?.filename.endsWith('/lib/auth/request.ts'))) {
        return { isStudentAuthEnabled: () => true, isTrustedAuthOrigin: origin => origin === 'http://localhost:3000' }
      }
      return oldLoad.call(this, name, ...args)
    }
    const load = file => { const path = require.resolve(file); loaded.push(path); delete require.cache[path]; return require(path) }
    return await run(load('./editor-contract.ts'), load('./editor-request.ts'))
  } finally {
    Module._load = oldLoad
    if (oldTs) Module._extensions['.ts'] = oldTs
    else delete Module._extensions['.ts']
    for (const path of loaded) delete require.cache[path]
  }
}

function request(body, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/admin/editor', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('all six family payloads satisfy the application contract; malformed input does not', () => fixture(contract => {
  const valid = [
    ['course_overview', { title: 'Overview', body: 'Body' }],
    ['note', { title: 'Note', body: 'Body' }],
    ['cbt_question', { prompt: 'Choose', options: ['A', 'B'], correctOption: 1 }],
    ['theory_question', { prompt: 'Explain' }],
    ['model_answer', { body: 'Answer' }],
    ['rubric', { body: 'Rubric' }],
  ]
  for (const [kind, payload] of valid) assert.deepEqual(contract.parseContentPayload(kind, payload), payload)
  assert.equal(contract.parseContentPayload('note', { title: ' ', body: 'Body' }), null)
  assert.equal(contract.parseContentPayload('cbt_question', { prompt: 'Q', options: ['A', 'B'], correctOption: 2 }), null)
  assert.equal(contract.parseContentPayload('theory_question', { prompt: 'Q', injected: '<script>' }), null)
}))

test('structured repository overview and note fields remain valid without flattening', () => fixture(contract => {
  const overview = { title: 'Course', body: 'Overview',
    topics: [{ chapter: '1', description: 'Intro' }], examFocus: ['Definitions'],
    keyTakeaways: [{ title: 'Principle', description: 'Meaning' }],
    formulaSheet: [{ name: 'Ratio', formula: 'A / B', explanation: 'Meaning', example: '4 / 2' }] }
  const topic = { title: 'Topic', body: 'Summary', noteType: 'topic_note',
    keyPoints: ['First point'], examTip: 'Review this' }
  const trick = { title: 'Calculator', body: 'Method', noteType: 'calculator_trick',
    example: '2 + 2 = 4', formula: 'x + y' }
  for (const [kind, payload] of [['course_overview', overview], ['note', topic], ['note', trick]]) {
    assert.deepEqual(contract.parseContentPayload(kind, payload), payload)
  }
  assert.equal(contract.parseContentPayload('note', { ...topic, keyPoints: [] }), null)
  assert.equal(contract.parseContentPayload('note', { ...trick, keyPoints: ['wrong subtype'] }), null)
  assert.equal(contract.parseContentPayload('course_overview', { ...overview, unknown: 'dropped' }), null)
}))

test('structured payload validation accepts the SQL byte limit and rejects the next byte', () => fixture(contract => {
  const examFocus = [...Array(26).fill('a'.repeat(10000)), 'a'.repeat(1994)]
  const within = { title: 'T', body: 'B', examFocus }
  // PostgreSQL jsonb::text uses 31 more separator spaces than this compact JSON.
  assert.equal(Buffer.byteLength(JSON.stringify(within), 'utf8') + 31, 262144)
  assert.deepEqual(contract.parseContentPayload('course_overview', within), within)
  assert.equal(contract.contentPayloadProblem('course_overview', within), null)
  assert.notEqual(contract.parseContentPayload('course_overview', { ...within, topics: undefined }), null)

  const beyond = { ...within, examFocus: [...examFocus.slice(0, -1), 'a'.repeat(1995)] }
  assert.equal(Buffer.byteLength(JSON.stringify(beyond), 'utf8') + 31, 262145)
  assert.equal(contract.parseContentPayload('course_overview', beyond), null)
  assert.match(contract.contentPayloadProblem('course_overview', beyond), /262,144-byte limit/)
}))

test('the shared limit measures multi-byte text for notes and dependent content', () => fixture(contract => {
  const within = { title: 'T', body: '😀'.repeat(65529) + 'aa' }
  const beyond = { title: 'T', body: '😀'.repeat(65530) }
  assert.equal(Buffer.byteLength(JSON.stringify(within), 'utf8') + 3, 262144)
  assert.equal(Buffer.byteLength(JSON.stringify(beyond), 'utf8') + 3, 262146)
  assert.deepEqual(contract.parseContentPayload('note', within), within)
  assert.equal(contract.parseContentPayload('note', beyond), null)
  assert.match(contract.contentPayloadProblem('note', beyond), /262,144-byte limit/)
  for (const kind of ['model_answer', 'rubric']) {
    const dependent = { body: '😀'.repeat(70000) }
    assert.equal(contract.parseContentPayload(kind, dependent), null)
    assert.match(contract.contentPayloadProblem(kind, dependent), /262,144-byte limit/)
  }
}))

test('editor request parser rejects cross-origin, malformed, and oversized writes', async () => fixture(async (_, parser) => {
  const mutation = { action: 'create', courseId: '40000000-0000-4000-8000-000000000001',
    kind: 'note', payload: { title: 'Note', body: 'Body' } }
  assert.deepEqual(await parser.readEditorMutation(request(mutation)), mutation)
  await assert.rejects(parser.readEditorMutation(request(mutation, 'https://external.test')),
    error => error.status === 403)
  await assert.rejects(parser.readEditorMutation(request({ ...mutation, userId: 'forged' })),
    error => error.status === 400)
  await assert.rejects(parser.readEditorMutation(request({ ...mutation, payload: { body: 'x'.repeat(290000) } })),
    error => error.status === 413)
}))
