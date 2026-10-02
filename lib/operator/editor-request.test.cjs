// lib/operator/editor-request.test.cjs — Same-origin editor input and family payload validation.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')

function fixture(run) {
  const oldLoad = Module._load
  const oldTs = Module._extensions['.ts']
  const loaded = []
  try {
    Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'server-only') return {}
      if (name === '@/lib/auth/config') return { getAuthOrigin: () => 'http://localhost:3000' }
      return oldLoad.call(this, name, ...args)
    }
    const load = file => { const path = require.resolve(file); loaded.push(path); delete require.cache[path]; return require(path) }
    return run(load('./editor-contract.ts'), load('./editor-request.ts'))
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
