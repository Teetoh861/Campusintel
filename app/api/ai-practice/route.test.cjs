// Direct requests cross the real parser, request service, course reader and
// eligibility function. Only authentication and external I/O are fixtures.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_CONTINUITY_HEADER } = require('../../../lib/auth/constants.ts')

const USER = '63000000-0000-4000-8000-000000000001'
const SESSION = '63000000-0000-4000-8000-000000000002'
const DOC = '64000000-0000-4000-8000-000000000001'
const REQUEST = '64000000-0000-4000-8000-000000000002'
const RETIRED = [
  ['50000000-0000-4000-8000-000000000145', 'BUA302', 'Human Behaviour in Organisations'],
  ['50000000-0000-4000-8000-000000000149', 'BUA325', 'Research Methodology for Business'],
]
const OFFERED = ['50000000-0000-4000-8000-000000000150', 'BUA303', 'Management Theory']
const reserve = courseId => ({ operation: 'reserve-upload', courseId, fileName: 'notes.txt',
  mediaType: 'text/plain', byteSize: 100 })

function offering() {
  const ref = (id, display_name) => ({ id, display_name, is_active: true })
  const department = ref('10000000-0000-4000-8000-000000000001', 'Business Administration')
  const academic_level = ref('20000000-0000-4000-8000-000000000001', '300 Level')
  const academic_period = ref('30000000-0000-4000-8000-000000000001', 'First Semester')
  return { department_id: department.id, academic_level_id: academic_level.id, academic_period_id: academic_period.id,
    department, academic_level, academic_period }
}

async function fixture(run) {
  const original = Module._load
  const files = ['./route.ts', '../../../lib/auth/request.ts', '../../../lib/courses/read-model.ts',
    '../../../lib/ai-practice/student-flow.ts', '../../../lib/ai-practice/supabase-env.ts'].map(file => require.resolve(file))
  const saved = files.map(file => require.cache[file])
  const state = {
    courses: new Map([...RETIRED, OFFERED].map(([id, course_code, display_title]) => [id, {
      id, course_code, display_title, is_free: false, repository_course_id: null, repository: null,
      applicability: id === OFFERED[0] ? [offering()] : [],
    }])),
    document: { id: DOC, institutional_course_id: RETIRED[0][0], storage_path: `${USER}/${DOC}`, file_name: 'notes.txt',
      media_type: 'text/plain', status: 'awaiting_upload', rejection_reason: null, source_text: null },
  }
  const effects = []
  const client = {
    from(table) {
      return { select: () => {
        const filters = []
        const query = {
          eq: (key, value) => { filters.push([key, value]); return query },
          maybeSingle: async () => {
            const values = Object.fromEntries(filters)
            if (table === 'institutional_courses') return { data: state.courses.get(values.id) ?? null, error: null }
            assert.equal(table, 'ai_practice_documents')
            assert.equal(values.user_id, USER, 'document reads remain scoped to the verified student')
            return { data: values.id === DOC ? structuredClone(state.document) : null, error: null }
          },
        }
        return query
      } }
    },
    async rpc(name) {
      effects.push(name)
      assert.equal(name, 'get_my_ai_allowance')
      return { data: { state: 'active', source: 'trial', total: 10, used: 0 }, error: null }
    },
    storage: { from: () => ({ createSignedUploadUrl: async path => {
      effects.push('sign-upload')
      assert.equal(path, `${USER}/${DOC}`)
      return { data: { signedUrl: 'https://storage.test/upload' }, error: null }
    } }) },
  }
  const service = { rpc: async (name, args) => {
    effects.push(name)
    assert.equal(args.p_session_id, SESSION)
    assert.equal(name, 'create_ai_practice_document', 'ineligible requests must stop before any write RPC')
    return { data: { status: 'created', document_id: DOC, storage_path: `${USER}/${DOC}` }, error: null }
  } }
  const authConfig = { isStudentAuthEnabled: () => true,
    isTrustedAuthOrigin: origin => origin === 'https://campusintell.test',
    getSupabaseConfig: () => ({ url: 'http://127.0.0.1:56821' }), getAuthSecretKey: () => 'test-only-key' }
  try {
    for (const file of files) delete require.cache[file]
    Module._load = function(name, parent, ...rest) {
      if (name === '@/lib/auth/config' || (name === './config' && parent?.filename.endsWith('/lib/auth/request.ts'))) {
        return authConfig
      }
      if (name === '@/lib/supabase/server') return { createClient: async () => client }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () => ({ user: { id: USER }, sessionId: SESSION }) }
      if (name === '@/lib/auth/account-continuity') return { matchesAccountContinuityToken: token => token === 'page-token' }
      if (name === '@supabase/supabase-js') return { createClient: () => service }
      if (name === './config' && parent?.filename.endsWith('/lib/ai-practice/supabase-env.ts')) return {
        isAiPracticeAvailable: () => true, readAiPracticeConfig: () => ({ status: 'enabled', timeoutMs: 5000 }),
        createConfiguredProvider: () => ({ id: 'anthropic', model: 'fixture', generate: async () => {
          effects.push('provider'); throw new Error('unexpected provider request')
        } }),
      }
      if (name === './extract' && parent?.filename.endsWith('/lib/ai-practice/supabase-env.ts')) return {
        extractUploadText: async () => { effects.push('extract'); throw new Error('unexpected extraction') },
      }
      return original.call(this, name, parent, ...rest)
    }
    const { POST } = require('./route.ts')
    const post = command => POST(new Request('https://campusintell.test/api/ai-practice', {
      method: 'POST', headers: { Origin: 'https://campusintell.test', 'Content-Type': 'application/json',
        [AUTH_CONTINUITY_HEADER]: 'page-token' }, body: JSON.stringify(command),
    }))
    await run({ state, effects, post })
  } finally {
    Module._load = original
    files.forEach((file, index) => { delete require.cache[file]; if (saved[index]) require.cache[file] = saved[index] })
  }
}

for (const [id, code] of RETIRED) {
  test(`direct ${code} requests with no offering return 403 before any AI or storage action`, async () => fixture(async f => {
    for (const [command, document] of [
      [reserve(id), {}],
      [{ operation: 'process-upload', documentId: DOC }, {}],
      [{ operation: 'process-upload', documentId: DOC }, { status: 'ready', source_text: 'Historical source text' }],
      [{ operation: 'generate', documentId: DOC, requestId: REQUEST }, { status: 'ready', source_text: 'Historical source text' }],
    ]) {
      Object.assign(f.state.document, { institutional_course_id: id }, document)
      const history = structuredClone(f.state.document)
      const response = await f.post(command)
      assert.equal(response.status, 403, command.operation)
      assert.deepEqual(await response.json(), { status: 'not-eligible' })
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.deepEqual(f.effects, [], 'no allowance read, reservation, extraction, provider call or history write')
      assert.deepEqual(f.state.document, history)
    }
  }))
}

test('a direct request for an active unbuilt BUA303 course reserves an upload', async () => fixture(async f => {
  const response = await f.post(reserve(OFFERED[0]))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'upload-reserved', documentId: DOC, uploadUrl: 'https://storage.test/upload' })
  assert.deepEqual(f.effects, ['get_my_ai_allowance', 'create_ai_practice_document', 'sign-upload'])
}))

test('direct requests reject inactive dimensions but accept a remaining offering elsewhere', async () => fixture(async f => {
  const course = f.state.courses.get(RETIRED[0][0])
  for (const dimension of ['department', 'academic_level', 'academic_period']) {
    const tuple = offering()
    tuple[dimension].is_active = false
    course.applicability = [tuple]
    const response = await f.post(reserve(course.id))
    assert.equal(response.status, 403, dimension)
    assert.deepEqual(await response.json(), { status: 'not-eligible' })
    assert.deepEqual(f.effects, [])
  }
  const elsewhere = offering()
  elsewhere.department_id = elsewhere.department.id = '10000000-0000-4000-8000-000000000002'
  elsewhere.department.display_name = 'Finance'
  const retiredDepartment = offering()
  retiredDepartment.department.is_active = false
  course.applicability = [retiredDepartment, elsewhere]
  assert.equal((await f.post(reserve(course.id))).status, 200,
    'an old BUA302 code remains usable if it still has an active offering in another department')
}))
