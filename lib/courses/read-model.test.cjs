// lib/courses/read-model.test.cjs — One structural truth for institutional identity, route capability and study readiness.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const Module = require('node:module')

const item = (kind, payload, extra = {}) => ({
  item_id: randomUUID(), course_id: randomUUID(), kind, question_id: null, source_key: null,
  parent_item_id: null, revision: 1, payload, ...extra,
})
const overviewItem = () => item('course_overview', { title: 'Overview', body: 'Published overview body',
  formulaSheet: [{ name: 'Break-Even Quantity (BEQ)', formula: 'BEQ = FC / (P − v)', explanation: 'Contribution per unit' }] })
const noteItem = () => item('note', { title: 'Topic note', body: 'Note body', noteType: 'topic_note', keyPoints: ['Point'] })
const trickItem = () => item('note', { title: 'Trick', body: 'Body', noteType: 'calculator_trick',
  example: 'FC ÷ (P − v)', formula: 'BEQ = FC ÷ (P − v)' })
const theoryItem = () => item('theory_question', { prompt: 'Explain the concept' })
const cbtItem = () => item('cbt_question', { prompt: 'Pick one', options: ['No', 'Yes'], correctOption: 1 },
  { question_id: randomUUID() })
const invalidItem = () => item('cbt_question', { prompt: 'No options' }, { question_id: randomUUID() })
const published = (...items) => ({ status: 'ok', content: items })

async function fixture(run, overrides = {}) {
  const originalLoad = Module._load
  const loaded = []
  const id = {
    student: randomUUID(), otherStudent: randomUUID(),
    department: randomUUID(), otherDepartment: randomUUID(),
    level: randomUUID(), otherLevel: randomUUID(),
    period: randomUUID(), otherPeriod: randomUUID(),
  }
  const state = {
    enabled: true, profileFailure: false, missingProfile: false, catalogueFailure: false,
    catalogueThrows: false, applicabilityFailure: false, bridgeFailure: false, ownerFailure: false,
    profile: { department_id: id.department, academic_level_id: id.level, academic_period_id: id.period },
    catalogueRows: [], applicabilityRows: [],
    repositories: new Map(), owners: new Map(), published: new Map(),
  }
  const calls = []
  const failure = { data: null, error: { message: 'database failure' } }
  const client = {
    from: table => {
      calls.push(['from', table])
      if (table === 'profiles') return { select: columns => ({ eq: (field, value) => ({ maybeSingle: async () => {
        calls.push(['profile', columns, field, value])
        if (state.profileFailure) return failure
        return { data: value === id.student && !state.missingProfile ? state.profile : null, error: null }
      } }) }) }
      if (table === 'institutional_courses') return { select: columns => {
        calls.push(['catalogueSelect', columns])
        const filters = []
        const query = {
          eq: (field, value) => { filters.push([field, value]); return query },
          maybeSingle: async () => {
            calls.push(['ownerLookup', filters])
            if (state.ownerFailure) return failure
            assert.deepEqual(filters.map(([field]) => field), ['repository_course_id'])
            return { data: state.owners.get(filters[0][1]) ?? null, error: null }
          },
          then: (resolve, reject) => {
            calls.push(['catalogueQuery', filters])
            if (state.catalogueThrows) return Promise.reject(new Error('network failure')).then(resolve, reject)
            return Promise.resolve(state.catalogueFailure ? failure : { data: state.catalogueRows, error: null })
              .then(resolve, reject)
          },
        }
        return query
      } }
      if (table === 'course_applicability') return { select: columns => {
        calls.push(['applicabilitySelect', columns])
        const filters = []
        const query = {
          eq: (field, value) => { filters.push([field, value]); return query },
          then: (resolve, reject) => {
            calls.push(['applicabilityFilters', filters])
            return Promise.resolve(state.applicabilityFailure ? failure : { data: state.applicabilityRows, error: null })
              .then(resolve, reject)
          },
        }
        return query
      } }
      assert.equal(table, 'courses')
      return { select: columns => ({ eq: (field, value) => ({ maybeSingle: async () => {
        calls.push(['bridge', columns, field, value])
        if (state.bridgeFailure) return failure
        return { data: state.repositories.get(value) ?? null, error: null }
      } }) }) }
    },
  }
  const mocks = {
    '@/lib/supabase/server': { createClient: async () => { throw new Error('the model must reuse the verified client') } },
    '@/lib/auth/config': { isStudentAuthEnabled: () => state.enabled },
    '@/lib/managed-content/published': { getPublishedManagedContentWithVerifiedClient: async (verifiedClient, courseId) => {
      assert.equal(verifiedClient, client, 'every publication read uses the verified request client')
      calls.push(['published', courseId])
      return state.published.get(courseId) ?? published()
    } },
    ...overrides,
  }
  const reference = (uuid, label) => ({ id: uuid, display_name: label, is_active: true })
  const tuple = (department = id.department, level = id.level, period = id.period) => ({
    department_id: department, academic_level_id: level, academic_period_id: period,
    department: reference(department, 'Department'), academic_level: reference(level, 'Level'),
    academic_period: reference(period, 'Period'),
  })
  const repository = (contentKey, isShared = false) => {
    if (!state.repositories.has(contentKey)) {
      state.repositories.set(contentKey, { id: randomUUID(), content_key: contentKey, is_shared: isShared })
    }
    return state.repositories.get(contentKey)
  }
  const identity = (code, contentKey = null, options = {}) => {
    const repo = contentKey === null ? null : repository(contentKey, 'isShared' in options ? options.isShared : false)
    if (repo !== null && options.published !== undefined) state.published.set(repo.id, options.published)
    return {
      id: options.institutionalId ?? randomUUID(), course_code: code,
      display_title: options.title ?? `${code} title`, is_free: options.isFree ?? false,
      repository_course_id: repo === null ? null : repo.id, repository: repo,
      applicability: options.applicability ?? [tuple()],
    }
  }
  const currentRow = catalogueRow => {
    const { applicability, ...institutional } = catalogueRow
    return { institutional_course_id: institutional.id, ...applicability[0], institutional }
  }
  try {
    Module._load = function (name, ...args) { return mocks[name] || originalLoad.call(this, name, ...args) }
    const load = file => {
      const path = require.resolve(file)
      loaded.push(path)
      delete require.cache[path]
      return require(path)
    }
    const domain = load('./read-model.ts')
    const catalogue = () => domain.getStudentCatalogueForVerifiedStudent(client)
    const current = (user = { id: id.student }) => domain.getCurrentStudentCoursesForVerifiedStudent(client, user)
    const lookup = slug => domain.getStudentCourseBySlugForVerifiedStudent(client, slug)
    await run({ id, state, calls, client, domain, tuple, repository, identity, currentRow, catalogue, current, lookup })
  } finally {
    Module._load = originalLoad
    for (const file of loaded) delete require.cache[file]
  }
}

const publishedIds = calls => calls.filter(call => call[0] === 'published').map(call => call[1])
const tables = calls => calls.filter(call => call[0] === 'from').map(call => call[1])

test('the full catalogue lists every identity once with all applicability from one structural query', async () => fixture(async f => {
  const entTuples = [f.tuple(f.id.otherDepartment), f.tuple(), f.tuple(f.id.department, f.id.otherLevel, f.id.otherPeriod)]
  const ent = f.identity('ENT211', 'entrepreneurship-innovation', { isShared: true, applicability: entTuples })
  const gst = f.identity('GST111', 'use-of-english', { isFree: true, isShared: true,
    applicability: [f.tuple(f.id.otherDepartment, f.id.otherLevel), f.tuple(f.id.department, f.id.otherLevel)] })
  f.state.catalogueRows = [ent, f.identity('ACC101'), gst]
  const result = await f.catalogue()
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.courses.map(course => course.code), ['ACC101', 'ENT211', 'GST111'])
  assert.equal(new Set(result.courses.map(course => course.institutionalCourseId)).size, 3)
  const shared = result.courses[1]
  assert.equal(shared.institutionalCourseId, ent.id)
  assert.equal(shared.repository.isShared, true)
  const tupleIds = row => [row.department.id, row.academicLevel.id, row.academicPeriod.id].join('/')
  assert.deepEqual(shared.applicability.map(tupleIds).sort(),
    entTuples.map(row => [row.department_id, row.academic_level_id, row.academic_period_id].join('/')).sort())
  assert.deepEqual(shared.applicability.find(row => row.department.id === f.id.otherDepartment).department,
    { id: f.id.otherDepartment, label: 'Department', isActive: true })
  assert.equal(result.courses[2].isFree, true)
  assert.equal(result.courses[2].applicability.length, 2)
  assert.deepEqual(tables(f.calls), ['institutional_courses'])
  assert.equal(f.calls.filter(call => call[0] === 'catalogueQuery').length, 1)
  assert.deepEqual(f.calls.find(call => call[0] === 'catalogueQuery')[1], [], 'the full catalogue is unfiltered')
  const select = f.calls.find(call => call[0] === 'catalogueSelect')[1]
  for (const fragment of [
    'id,course_code,display_title,is_free,repository_course_id',
    'repository:courses!institutional_courses_repository_course_id_fkey(id,content_key,is_shared)',
    'applicability:course_applicability!course_applicability_institutional_course_id_fkey(',
    'department:departments!course_applicability_department_id_fkey(id,display_name,is_active)',
    'academic_level:academic_levels!course_applicability_academic_level_id_fkey(id,display_name,is_active)',
    'academic_period:academic_periods!course_applicability_academic_period_id_fkey(id,display_name,is_active)',
  ]) assert.ok(select.includes(fragment), fragment)
  assert.doesNotMatch(select, /slug/)
}))

test('an unlinked institutional course is not built, has no route and triggers no publication read', async () => fixture(async f => {
  const row = f.identity('ACC101', null, { title: 'Introduction to Financial Accounting I' })
  f.state.catalogueRows = [row]
  const result = await f.catalogue()
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.courses, [{
    institutionalCourseId: row.id, code: 'ACC101', title: 'Introduction to Financial Accounting I', isFree: false,
    applicability: [{
      department: { id: f.id.department, label: 'Department', isActive: true },
      academicLevel: { id: f.id.level, label: 'Level', isActive: true },
      academicPeriod: { id: f.id.period, label: 'Period', isActive: true },
    }],
    repository: { state: 'unlinked' },
    content: { state: 'not-built', reason: 'unlinked' },
  }])
  assert.deepEqual(publishedIds(f.calls), [])
}))

test('a linked but unshelved repository keeps its identity, still reads publication and never gets a slug or CBT', async () => fixture(async f => {
  const row = f.identity('BUA299', 'provisioned-2f1c9a', { isShared: null,
    published: published(overviewItem(), noteItem(), theoryItem(), cbtItem()) })
  f.state.catalogueRows = [row]
  const result = await f.catalogue()
  assert.equal(result.status, 'ok')
  const [course] = result.courses
  assert.deepEqual(course.repository, { state: 'unshelved-repository',
    repositoryCourseId: row.repository.id, contentKey: 'provisioned-2f1c9a', isShared: null })
  assert.deepEqual(course.content, { state: 'ready',
    study: { notes: true, cbtPractice: false, theory: true, overview: true } })
  assert.deepEqual(publishedIds(f.calls), [row.repository.id])
  assert.doesNotMatch(JSON.stringify(course), /\/courses\/|"slug"|"route"/)
}))

test('a shelved course with nothing published keeps its route and reports no published learning', async () => fixture(async f => {
  const row = f.identity('BUA201', 'principles-business-administration', { published: published() })
  f.state.catalogueRows = [row]
  const result = await f.catalogue()
  const [course] = result.courses
  assert.equal(course.repository.state, 'shelved')
  assert.equal(course.repository.route.href, '/courses/principles-business-administration')
  assert.equal(course.repository.route.course.contentKey, 'principles-business-administration')
  assert.deepEqual(course.content, { state: 'no-published-learning',
    study: { notes: false, cbtPractice: false, theory: false, overview: false } })
}))

test('an overview alone is context, never Notes and never ready', async () => fixture(async f => {
  f.state.catalogueRows = [f.identity('BUA216', 'introduction-financial-management', { published: published(overviewItem()) })]
  const [course] = (await f.catalogue()).courses
  assert.equal(course.repository.state, 'shelved')
  assert.deepEqual(course.content, { state: 'no-published-learning',
    study: { notes: false, cbtPractice: false, theory: false, overview: true } })
}))

test('one validated published note makes Notes true and the course ready', async () => fixture(async f => {
  f.state.catalogueRows = [
    f.identity('BUA201', 'principles-business-administration', { published: published(noteItem()) }),
    f.identity('BUA203', 'business-statistics', { published: published(overviewItem(), trickItem()) }),
  ]
  const result = await f.catalogue()
  assert.deepEqual(result.courses.map(course => course.content), [
    { state: 'ready', study: { notes: true, cbtPractice: false, theory: false, overview: false } },
    { state: 'ready', study: { notes: true, cbtPractice: false, theory: false, overview: true } },
  ])
}))

test('CBT follows getUsableManagedQuiz exactly, including unusable or missing quiz configuration', async () => {
  const { getCourseByContentKey } = require('../data/courses.ts')
  const { getQuizConfigurationByCourseSlug } = require('../data/quizzes.ts')
  const { getUsableManagedQuiz } = require('../managed-content/quiz.ts')
  const { projectStudentLearning } = require('../managed-content/student-projection.ts')
  const course = getCourseByContentKey('financial-accounting-1')
  const config = getQuizConfigurationByCourseSlug(course.slug)
  const bank = published(cbtItem(), cbtItem())
  await fixture(async f => {
    f.state.catalogueRows = [f.identity('ACC-CM201', 'financial-accounting-1', { published: bank })]
    const [resolved] = (await f.catalogue()).courses
    const expected = getUsableManagedQuiz(course.slug, config, projectStudentLearning(bank.content).learning.quizQuestions)
    assert.notEqual(expected, null)
    assert.deepEqual(resolved.content, { state: 'ready',
      study: { notes: false, cbtPractice: true, theory: false, overview: false } })
  })
  for (const invalid of [undefined, { ...config, maxQuizQuestions: 0 }, { ...config, quizDurationMinutes: 1e308 },
    { ...config, courseSlug: 'another-course' }]) {
    await fixture(async f => {
      f.state.catalogueRows = [f.identity('ACC-CM201', 'financial-accounting-1', { published: bank })]
      const [resolved] = (await f.catalogue()).courses
      assert.equal(getUsableManagedQuiz(course.slug, invalid, projectStudentLearning(bank.content).learning.quizQuestions), null)
      assert.deepEqual(resolved.content, { state: 'no-published-learning',
        study: { notes: false, cbtPractice: false, theory: false, overview: false } })
    }, { '@/lib/data/quizzes': { getQuizConfigurationByCourseSlug: () => invalid } })
  }
})

test('one validated published theory question makes Theory true', async () => fixture(async f => {
  f.state.catalogueRows = [
    f.identity('ACC-CM201', 'financial-accounting-1', { published: published(theoryItem()) }),
    f.identity('BUA205', 'leadership-governance', { published: published(overviewItem()) }),
  ]
  const result = await f.catalogue()
  assert.deepEqual(result.courses.map(course => [course.content.state, course.content.study.theory]),
    [['ready', true], ['no-published-learning', false]])
}))

test('the canonical route comes only from content_key through the static shelf, never code or title', async () => {
  const contentKey = 'fixture-accounting-content'
  const realCourse = require('../data/courses.ts').getCourseByContentKey('financial-accounting-1')
  const linkedCourse = { ...realCourse, contentKey }
  const lookups = []
  await fixture(async f => {
    f.state.catalogueRows = [f.identity('ACC-CM201', contentKey, { title: 'Financial Accounting I', published: published(noteItem()) })]
    const [course] = (await f.catalogue()).courses
    assert.deepEqual(lookups, [contentKey])
    assert.equal(course.repository.state, 'shelved')
    assert.equal(course.repository.route.slug, realCourse.slug)
    assert.equal(course.repository.route.href, `/courses/${realCourse.slug}`)
    assert.equal(course.repository.contentKey, contentKey)
    assert.doesNotMatch(course.repository.route.href, /acc-cm201|financial-accounting-i\b|Financial Accounting I/i)
    assert.equal(course.content.state, 'ready')
  }, { '@/lib/data/courses': {
    getCourseByContentKey: key => { lookups.push(key); return key === contentKey ? linkedCourse : undefined },
    getCourseBySlug: slug => slug === linkedCourse.slug ? linkedCourse : undefined,
  } })
})

test('one ordinary publication or projection failure is local; a lost session fails the whole read', async () => fixture(async f => {
  f.state.catalogueRows = [
    f.identity('BUA201', 'principles-business-administration', { published: published(noteItem()) }),
    f.identity('BUA203', 'business-statistics', { published: { status: 'unavailable' } }),
    f.identity('BUA205', 'leadership-governance', { published: published(invalidItem()) }),
    f.identity('ACC101'),
  ]
  const result = await f.catalogue()
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.courses.map(course => course.content), [
    { state: 'not-built', reason: 'unlinked' },
    { state: 'ready', study: { notes: true, cbtPractice: false, theory: false, overview: false } },
    { state: 'temporarily-unavailable', reason: 'publication-read-failed' },
    { state: 'temporarily-unavailable', reason: 'projection-failed' },
  ])
  assert.deepEqual(result.courses.slice(1).map(course => course.repository.state), ['shelved', 'shelved', 'shelved'])
  assert.deepEqual(publishedIds(f.calls).sort(),
    f.state.catalogueRows.slice(0, 3).map(row => row.repository.id).sort(), 'publication reads cover exactly the linked subset')
  f.calls.length = 0
  f.state.published.set(f.state.catalogueRows[1].repository.id, { status: 'signed-out' })
  assert.deepEqual(await f.catalogue(), { status: 'signed-out' })
  assert.equal(publishedIds(f.calls).length, 3, 'the bounded fan-out still used the one verified client')
}))

test('structural query failures are unavailable, never invariant failures or empty catalogues', async () => fixture(async f => {
  f.state.catalogueRows = [f.identity('BUA201', 'principles-business-administration')]
  f.state.catalogueFailure = true
  assert.deepEqual(await f.catalogue(), { status: 'unavailable' })
  f.state.catalogueFailure = false
  f.state.catalogueThrows = true
  assert.deepEqual(await f.catalogue(), { status: 'unavailable' })
  assert.deepEqual(publishedIds(f.calls), [])
  f.state.catalogueThrows = false
  f.state.enabled = false
  f.calls.length = 0
  assert.deepEqual(await f.catalogue(), { status: 'unavailable' })
  assert.deepEqual(f.calls, [])
}))

test('malformed, duplicate and mismatched structural rows are invariant failures', async () => fixture(async f => {
  const linked = () => f.identity('BUA201', 'principles-business-administration')
  const unlinked = () => f.identity('ACC101')
  const sameId = randomUUID()
  const cases = [
    ['repository as an array', [{ ...linked(), repository: [linked().repository] }]],
    ['applicability as an object', [{ ...linked(), applicability: f.tuple() }]],
    ['missing reference embed', [{ ...unlinked(), applicability: [{ ...f.tuple(), department: null }] }]],
    ['unknown column', [{ ...unlinked(), slug: 'fabricated' }]],
    ['reference ID disagrees with tuple ID', [{ ...unlinked(),
      applicability: [{ ...f.tuple(), department: { id: f.id.otherDepartment, display_name: 'Other', is_active: true } }] }]],
    ['duplicate applicability tuple', [{ ...unlinked(), applicability: [f.tuple(), f.tuple()] }]],
    ['duplicate institutional identity', [f.identity('BUA201', null, { institutionalId: sameId }),
      f.identity('BUA201', null, { institutionalId: sameId })]],
    ['linked without a repository embed', [{ ...linked(), repository: null }]],
    ['repository embed with a different ID', [{ ...linked(), repository: { ...linked().repository, id: randomUUID() } }]],
    ['repository embed without a link', [{ ...unlinked(), repository: linked().repository }]],
    ['content key outside the registry format', [{ ...linked(), repository: { ...linked().repository, content_key: 'Not A Key' } }]],
    ['row cap reached', Array.from({ length: 1000 }, () => unlinked())],
  ]
  for (const [name, rows] of cases) {
    f.state.catalogueRows = rows
    assert.deepEqual(await f.catalogue(), { status: 'invariant-failure' }, name)
  }
  assert.deepEqual(publishedIds(f.calls), [], 'no publication read happens for a contradictory catalogue')
}))

test('the current-student read filters by all three selected IDs in PostgREST and reuses the derivation', async () => fixture(async f => {
  const row = f.identity('BUA201', 'principles-business-administration', { isFree: true, published: published(noteItem(), cbtItem()) })
  f.state.catalogueRows = [row]
  f.state.applicabilityRows = [f.currentRow(row)]
  const expected = await f.catalogue()
  f.calls.length = 0
  const result = await f.current()
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.selection, { departmentId: f.id.department, academicLevelId: f.id.level, academicPeriodId: f.id.period })
  assert.deepEqual(result.courses, expected.courses, 'one StudentCourse derivation serves both readers')
  assert.deepEqual(f.calls.filter(call => call[0] === 'profile'),
    [['profile', 'department_id,academic_level_id,academic_period_id', 'id', f.id.student]])
  assert.deepEqual(f.calls.filter(call => call[0] === 'applicabilityFilters'), [['applicabilityFilters', [
    ['department_id', f.id.department], ['academic_level_id', f.id.level], ['academic_period_id', f.id.period],
  ]]])
  assert.deepEqual(tables(f.calls), ['profiles', 'course_applicability'], 'no full-catalogue query, no per-course identity query')
  const select = f.calls.find(call => call[0] === 'applicabilitySelect')[1]
  assert.match(select, /institutional:institutional_courses!course_applicability_institutional_course_id_fkey\(/)
  assert.match(select, /repository:courses!institutional_courses_repository_course_id_fkey\(id,content_key,is_shared\)/)
  assert.match(select, /department:departments!course_applicability_department_id_fkey\(id,display_name,is_active\)/)
  assert.deepEqual(publishedIds(f.calls), [row.repository.id])
  assert.equal(result.courses[0].isFree, true)
  assert.deepEqual(result.courses[0].content, { state: 'ready',
    study: { notes: true, cbtPractice: true, theory: false, overview: false } }, 'the static quiz policy makes the published bank usable')
  assert.deepEqual(await f.current({ id: f.id.otherStudent }), { status: 'missing-profile' })
}))

test('current-student profile and selection states stop before catalogue access', async () => fixture(async f => {
  f.state.applicabilityRows = [f.currentRow(f.identity('BUA201', 'principles-business-administration'))]
  f.state.enabled = false
  assert.deepEqual(await f.current(), { status: 'unavailable' })
  assert.deepEqual(f.calls, [])
  f.state.enabled = true
  f.state.profileFailure = true
  assert.deepEqual(await f.current(), { status: 'unavailable' })
  f.state.profileFailure = false
  f.state.missingProfile = true
  assert.deepEqual(await f.current(), { status: 'missing-profile' })
  f.state.missingProfile = false
  f.state.profile = { department_id: null, academic_level_id: null, academic_period_id: null }
  assert.deepEqual(await f.current(), { status: 'incomplete' })
  f.state.profile = { department_id: f.id.department, academic_level_id: null, academic_period_id: f.id.period }
  assert.deepEqual(await f.current(), { status: 'invariant-failure' })
  assert.equal(f.calls.some(call => call[0] === 'applicabilitySelect' || call[0] === 'published'), false)
  f.state.profile = { department_id: f.id.department, academic_level_id: f.id.level, academic_period_id: f.id.period }
  f.state.applicabilityFailure = true
  assert.deepEqual(await f.current(), { status: 'unavailable' })
  f.state.applicabilityFailure = false
  f.state.applicabilityRows = []
  assert.deepEqual(await f.current(), { status: 'ok', selection: {
    departmentId: f.id.department, academicLevelId: f.id.level, academicPeriodId: f.id.period,
  }, courses: [] })
}))

test('current-student rows that contradict the selection or their identity are invariant failures', async () => fixture(async f => {
  const row = f.currentRow(f.identity('BUA201', 'principles-business-administration'))
  const cases = [
    ['mismatched institutional ID', [{ ...row, institutional_course_id: randomUUID() }]],
    ['duplicate institutional row', [row, row]],
    ['tuple outside the selection', [{ ...row, department_id: f.id.otherDepartment,
      department: { id: f.id.otherDepartment, display_name: 'Other', is_active: true } }]],
    ['missing institutional relation', [{ ...row, institutional: null }]],
    ['linked identity without its repository embed', [{ ...row, institutional: { ...row.institutional, repository: null } }]],
  ]
  for (const [name, rows] of cases) {
    f.state.applicabilityRows = rows
    assert.deepEqual(await f.current(), { status: 'invariant-failure' }, name)
  }
  f.state.applicabilityRows = [{ ...row, institutional: { ...row.institutional, repository: null, repository_course_id: null } }]
  const result = await f.current()
  assert.deepEqual(result.courses.map(course => course.repository), [{ state: 'unlinked' }])
}))

test('current-student publication failures stay local and a lost session routes signed out', async () => fixture(async f => {
  const rows = [
    f.identity('BUA201', 'principles-business-administration', { published: published(noteItem()) }),
    f.identity('BUA203', 'business-statistics', { published: { status: 'unavailable' } }),
    f.identity('ACC101'),
  ]
  f.state.applicabilityRows = rows.map(f.currentRow)
  const result = await f.current()
  assert.deepEqual(result.courses.map(course => course.content.state), ['not-built', 'ready', 'temporarily-unavailable'])
  f.state.published.set(rows[0].repository.id, { status: 'signed-out' })
  assert.deepEqual(await f.current(), { status: 'signed-out' })
}))

test('ordering is institutional code then institutional ID for both readers', async () => fixture(async f => {
  const highId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  const lowId = '00000000-0000-4000-8000-000000000001'
  const rows = [
    f.identity('ZZZ101'),
    f.identity('BUA201', null, { institutionalId: highId, isFree: true }),
    f.identity('BUA201', null, { institutionalId: lowId }),
    f.identity('ACC101'),
  ]
  f.state.catalogueRows = rows
  f.state.applicabilityRows = rows.map(f.currentRow)
  for (const result of [await f.catalogue(), await f.current()]) {
    assert.equal(result.status, 'ok')
    assert.deepEqual(result.courses.map(course => course.code), ['ACC101', 'BUA201', 'BUA201', 'ZZZ101'])
    assert.deepEqual(result.courses.filter(course => course.code === 'BUA201').map(course => course.institutionalCourseId),
      [lowId, highId])
    assert.equal(result.courses[2].isFree, true)
  }
}))

test('an unknown slug is not found without touching the database', async () => fixture(async f => {
  assert.deepEqual(await f.lookup('not-a-course'), { status: 'not-found' })
  assert.deepEqual(await f.lookup('BUA201'), { status: 'not-found' }, 'an institutional code is not a route')
  assert.deepEqual(f.calls, [])
  f.state.enabled = false
  assert.deepEqual(await f.lookup('financial-accounting-1'), { status: 'unavailable' })
}))

test('the four deliberately unlinked repository identities resolve as repository-only, never institutional', async () => fixture(async f => {
  const { getCourseBySlug } = require('../data/courses.ts')
  for (const key of ['business-mathematics', 'consumer-behaviour', 'financial-accounting-1',
    'international-organisational-behaviour']) {
    const repo = f.repository(key, null)
    f.state.published.set(repo.id, published(overviewItem(), trickItem(), theoryItem()))
    f.calls.length = 0
    const result = await f.lookup(key)
    assert.equal(result.status, 'repository-only', key)
    assert.deepEqual(Object.keys(result.course).sort(), ['content', 'repository'])
    assert.deepEqual(result.course.repository, { state: 'shelved', repositoryCourseId: repo.id, contentKey: key, isShared: null,
      route: { slug: key, href: `/courses/${key}`, course: getCourseBySlug(key) } })
    assert.deepEqual(result.course.content, { state: 'ready',
      study: { notes: true, cbtPractice: false, theory: true, overview: true } })
    assert.doesNotMatch(JSON.stringify({ ...result.course, repository: { ...result.course.repository, route: null } }),
      /institutionalCourseId|"code"|"title"|applicability|display_title|course_code/)
    assert.deepEqual(f.calls.filter(call => call[0] === 'bridge'), [['bridge', 'id,content_key,is_shared', 'content_key', key]])
    assert.deepEqual(f.calls.filter(call => call[0] === 'ownerLookup'), [['ownerLookup', [['repository_course_id', repo.id]]]])
    assert.deepEqual(publishedIds(f.calls), [repo.id])
  }
}))

test('a linked one-course lookup returns the full StudentCourse and keeps every boundary explicit', async () => fixture(async f => {
  const row = f.identity('BUA201', 'principles-business-administration', { isFree: true,
    applicability: [f.tuple(), f.tuple(f.id.otherDepartment)], published: published(noteItem()) })
  f.state.owners.set(row.repository.id, row)
  const result = await f.lookup('principles-business-administration')
  assert.equal(result.status, 'ok')
  assert.equal(result.course.institutionalCourseId, row.id)
  assert.equal(result.course.code, 'BUA201')
  assert.equal(result.course.isFree, true)
  assert.equal(result.course.applicability.length, 2)
  assert.equal(result.course.repository.route.href, '/courses/principles-business-administration')
  assert.deepEqual(result.course.content, { state: 'ready',
    study: { notes: true, cbtPractice: false, theory: false, overview: false } })
  assert.deepEqual(tables(f.calls), ['courses', 'institutional_courses'])
  assert.deepEqual(publishedIds(f.calls), [row.repository.id])
  f.state.published.set(row.repository.id, { status: 'signed-out' })
  assert.deepEqual(await f.lookup('principles-business-administration'), { status: 'signed-out' })
  f.state.published.set(row.repository.id, { status: 'unavailable' })
  assert.equal((await f.lookup('principles-business-administration')).course.content.state, 'temporarily-unavailable')
  f.state.owners.set(row.repository.id, { ...row, repository: { ...row.repository, id: randomUUID() } })
  assert.deepEqual(await f.lookup('principles-business-administration'), { status: 'invariant-failure' })
  f.state.owners.set(row.repository.id, row)
  f.state.ownerFailure = true
  assert.deepEqual(await f.lookup('principles-business-administration'), { status: 'unavailable' })
  f.state.ownerFailure = false
  f.state.bridgeFailure = true
  assert.deepEqual(await f.lookup('principles-business-administration'), { status: 'unavailable' })
  f.state.bridgeFailure = false
  f.state.repositories.delete('principles-business-administration')
  assert.deepEqual(await f.lookup('principles-business-administration'), { status: 'not-found' })
}))
