const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const Module = require('node:module')

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
    enabled: true, signedOut: false, authFailure: false, profileFailure: false,
    missingProfile: false, applicabilityFailure: false,
    published: new Map(),
    profile: {
      department_id: id.department,
      academic_level_id: id.level,
      academic_period_id: id.period,
    },
    rows: [],
  }
  const calls = []
  const client = {
    auth: { getUser: async () => {
      calls.push(['getUser'])
      if (state.authFailure) return { data: { user: null }, error: { message: 'provider failure' } }
      if (state.signedOut) return { data: { user: null }, error: { name: 'AuthSessionMissingError' } }
      return { data: { user: { id: id.student } }, error: null }
    } },
    from: table => {
      calls.push(['from', table])
      if (table === 'profiles') return {
        select: columns => ({ eq: (field, value) => ({ maybeSingle: async () => {
          calls.push(['profile', columns, field, value])
          if (state.profileFailure) return { data: null, error: { message: 'database failure' } }
          return {
            data: value === id.student && !state.missingProfile ? state.profile : null,
            error: null,
          }
        } }) }),
      }
      assert.equal(table, 'course_applicability')
      return {
        select: columns => {
          calls.push(['applicabilitySelect', columns])
          const filters = []
          const query = {
            eq: (field, value) => { filters.push([field, value]); return query },
            then: (resolve, reject) => {
              calls.push(['applicabilityFilters', filters])
              return Promise.resolve(state.applicabilityFailure
                ? { data: null, error: { message: 'database failure' } }
                : { data: state.rows, error: null }).then(resolve, reject)
            },
          }
          return query
        },
      }
    },
  }
  const mocks = {
    '@/lib/supabase/server': { createClient: async () => { calls.push(['createClient']); return client } },
    '@/lib/auth/config': { isStudentAuthEnabled: () => state.enabled },
    '@/lib/managed-content/published': { getPublishedManagedContentWithVerifiedClient: async (verifiedClient, courseId) => {
      assert.equal(verifiedClient, client, 'published content uses the validated RLS client')
      calls.push(['published', courseId])
      return state.published.get(courseId) ?? { status: 'unavailable' }
    } },
    '@/lib/managed-content/student-projection': { projectStudentLearning: content =>
      content[0].projectionFails
        ? { status: 'unavailable' } : { status: 'ok', learning: content[0].learning } },
    ...overrides,
  }
  const row = (code, contentKey = null, options = {}) => {
    const institutionalId = options.institutionalId ?? randomUUID()
    const repositoryCourseId = contentKey === null ? null : randomUUID()
    if (repositoryCourseId !== null) state.published.set(repositoryCourseId,
      options.published ?? { status: 'ok', content: [{ projectionFails: options.projectionFails, learning: options.learning ?? {
        overview: { body: 'Published course overview' }, theoryQuestions: [], quizQuestions: [],
      } }] })
    return {
      institutional_course_id: institutionalId,
      institutional: {
        id: institutionalId, course_code: code, display_title: options.title ?? `${code} title`,
        is_free: options.isFree ?? false, repository_course_id: repositoryCourseId,
        content: contentKey === null ? null : { id: repositoryCourseId, content_key: contentKey },
      },
    }
  }
  try {
    Module._load = function (name, ...args) { return mocks[name] || originalLoad.call(this, name, ...args) }
    const load = file => {
      const path = require.resolve(file)
      loaded.push(path)
      delete require.cache[path]
      return require(path)
    }
    load('../auth/student-state.ts')
    const domain = load('./current-student-courses.ts')
    await run({ id, state, calls, client, domain, row })
  } finally {
    Module._load = originalLoad
    for (const file of loaded) delete require.cache[file]
  }
}

test('the live session owns the profile and all three applicability filters', async () => fixture(async f => {
  assert.equal(f.domain.getCurrentStudentCourses.length, 0)
  f.state.rows = [f.row('BUA201', 'principles-business-administration', { isFree: true })]
  const result = await f.domain.getCurrentStudentCourses({
    userId: f.id.otherStudent,
    departmentId: f.id.otherDepartment,
    academicLevelId: f.id.otherLevel,
    academicPeriodId: f.id.otherPeriod,
  })
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.selection, {
    departmentId: f.id.department, academicLevelId: f.id.level, academicPeriodId: f.id.period,
  })
  assert.deepEqual(f.calls.filter(call => call[0] === 'profile'), [[
    'profile', 'department_id,academic_level_id,academic_period_id', 'id', f.id.student,
  ]])
  assert.deepEqual(f.calls.filter(call => call[0] === 'applicabilityFilters'), [[
    'applicabilityFilters', [
      ['department_id', f.id.department],
      ['academic_level_id', f.id.level],
      ['academic_period_id', f.id.period],
    ],
  ]])
  assert.equal(f.calls.filter(call => call[0] === 'createClient').length, 1)
  assert.equal(f.calls.filter(call => call[0] === 'getUser').length, 1)
  const select = f.calls.find(call => call[0] === 'applicabilitySelect')[1]
  assert.match(select, /institutional:institutional_courses!course_applicability_institutional_course_id_fkey/)
  assert.match(select, /content:courses!institutional_courses_repository_course_id_fkey/)
  assert.equal(result.courses[0].code, 'BUA201')
  assert.equal(result.courses[0].isFree, true)
  assert.equal(result.courses[0].content.state, 'ready')
  assert.deepEqual(Object.keys(result.courses[0]).sort(),
    ['institutionalCourseId', 'code', 'title', 'isFree', 'content'].sort())
  assert.deepEqual(Object.keys(result.courses[0].content).sort(),
    ['state', 'courseSlug', 'courseHref', 'availability'].sort())
  assert.equal(result.courses[0].content.courseSlug, 'principles-business-administration')
  assert.equal(result.courses[0].content.courseHref, '/courses/principles-business-administration')
  assert.deepEqual(result.courses[0].content.availability, {
    overview: true, theory: false, quiz: false,
  })
  assert.deepEqual(f.calls.filter(call => call[0] === 'published'),
    [['published', f.state.rows[0].institutional.repository_course_id]])
}))

test('multiple linked courses reuse one live validation and one RLS client', async () => fixture(async f => {
  f.state.rows = [
    f.row('BUA201', 'principles-business-administration'),
    f.row('ACC201', 'financial-accounting-1'),
    f.row('BUA203'),
  ]
  const result = await f.domain.getCurrentStudentCourses()
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.courses.map(course => course.content.state), ['ready', 'ready', 'not-built'])
  assert.equal(f.calls.filter(call => call[0] === 'createClient').length, 1)
  assert.equal(f.calls.filter(call => call[0] === 'getUser').length, 1)
  assert.deepEqual(f.calls.filter(call => call[0] === 'published').map(call => call[1]),
    f.state.rows.slice(0, 2).map(row => row.institutional.repository_course_id))
  assert.ok(f.calls.findIndex(call => call[0] === 'getUser') <
    f.calls.findIndex(call => call[0] === 'published'), 'live validation precedes published reads')
}))

test('Dashboard reuses its verified client for membership and published reads', async () => fixture(async f => {
  f.state.rows = [
    f.row('BUA201', 'principles-business-administration'),
    f.row('ACC201', 'financial-accounting-1'),
  ]
  const result = await f.domain.getCurrentStudentCoursesForVerifiedStudent(
    f.client, { id: f.id.student })
  assert.equal(result.status, 'complete')
  assert.equal(f.calls.filter(call => call[0] === 'createClient' || call[0] === 'getUser').length, 0)
  assert.equal(f.calls.filter(call => call[0] === 'published').length, 2)
  assert.deepEqual(f.calls.filter(call => call[0] === 'profile').map(call => call[3]), [f.id.student])
}))

test('verified-client course reads fail closed when the user is outside client RLS', async () => fixture(async f => {
  f.state.rows = [f.row('BUA201', 'principles-business-administration')]
  assert.deepEqual(await f.domain.getCurrentStudentCoursesForVerifiedStudent(
    f.client, { id: f.id.otherStudent }), { status: 'missing-profile' })
  assert.equal(f.calls.some(call => call[0] === 'published' || call[0] === 'applicabilitySelect'), false)
  f.state.enabled = false
  assert.deepEqual(await f.domain.getCurrentStudentCoursesForVerifiedStudent(
    f.client, { id: f.id.student }), { status: 'unavailable' })
}))

test('a confirmed content key resolves a repository course with a different route slug', async () => {
  const contentKey = 'fixture-accounting-content'
  const realCourse = require('../data/courses.ts').getCourseByContentKey('financial-accounting-1')
  const linkedCourse = { ...realCourse, contentKey }
  const lookups = []
  await fixture(async f => {
    f.state.rows = [f.row('ACC-CM201', contentKey)]
    const result = await f.domain.getCurrentStudentCourses()
    assert.equal(result.status, 'complete')
    assert.deepEqual(lookups, [contentKey])
    assert.equal(result.courses[0].content.state, 'ready')
    assert.equal(result.courses[0].content.courseSlug, realCourse.slug)
    assert.equal(result.courses[0].content.courseHref, `/courses/${realCourse.slug}`)
    assert.deepEqual(result.courses[0].content.availability, {
      overview: true, theory: false, quiz: false,
    })
  }, { '@/lib/data/courses': {
    getCourseByContentKey: key => {
      lookups.push(key)
      return key === contentKey ? linkedCourse : undefined
    },
    getCourseBySlug: slug => slug === linkedCourse.slug ? linkedCourse : undefined,
  } })
})

test('auth and profile states stop before catalogue access', async () => fixture(async f => {
  f.state.enabled = false
  assert.deepEqual(await f.domain.getCurrentStudentCourses(), { status: 'unavailable' })
  assert.equal(f.calls.length, 0)

  f.state.enabled = true
  f.state.signedOut = true
  assert.deepEqual(await f.domain.getCurrentStudentCourses(), { status: 'signed-out' })
  assert.equal(f.calls.some(call => call[0] === 'from'), false)
  assert.equal(f.calls.some(call => call[0] === 'published'), false)

  f.state.signedOut = false
  f.state.authFailure = true
  assert.deepEqual(await f.domain.getCurrentStudentCourses(), { status: 'unavailable' })
  assert.equal(f.calls.some(call => call[0] === 'published'), false)

  f.state.authFailure = false
  f.state.missingProfile = true
  assert.deepEqual(await f.domain.getCurrentStudentCourses(), { status: 'missing-profile' })

  f.state.missingProfile = false
  f.state.profile = { department_id: null, academic_level_id: null, academic_period_id: null }
  assert.deepEqual(await f.domain.getCurrentStudentCourses(), { status: 'incomplete' })
  f.state.profile = { department_id: f.id.department, academic_level_id: null, academic_period_id: f.id.period }
  assert.deepEqual(await f.domain.getCurrentStudentCourses(), { status: 'invariant-failure' })
  assert.equal(f.calls.some(call => call[0] === 'applicabilitySelect'), false)
}))

test('an empty complete selection remains complete', async () => fixture(async f => {
  assert.deepEqual(await f.domain.getCurrentStudentCourses(), {
    status: 'complete',
    selection: {
      departmentId: f.id.department, academicLevelId: f.id.level, academicPeriodId: f.id.period,
    },
    courses: [],
  })
}))

test('provider and Supabase read errors remain unavailable', async () => fixture(async f => {
  f.state.applicabilityFailure = true
  assert.deepEqual(await f.domain.getCurrentStudentCourses(), { status: 'unavailable' })
  f.state.applicabilityFailure = false
  f.state.profileFailure = true
  assert.deepEqual(await f.domain.getCurrentStudentCourses(), { status: 'unavailable' })
}))

test('malformed applicability embeds and duplicate rows are invariant failures', async () => fixture(async f => {
  const row = f.row('BUA201')
  const malformed = [
    ['missing institutional relation', [{ ...row, institutional: null }]],
    ['array instead of a to-one relation', [{ ...row, institutional: [row.institutional] }]],
    ['mismatched institutional ID', [{
      ...row, institutional: { ...row.institutional, id: f.id.otherStudent },
    }]],
    ['duplicate institutional row', [row, row]],
  ]
  for (const [name, rows] of malformed) {
    f.state.rows = rows
    assert.deepEqual(await f.domain.getCurrentStudentCourses(),
      { status: 'invariant-failure' }, name)
  }
}))

test('unbuilt courses remain visible and sorting uses institutional code then ID', async () => fixture(async f => {
  const highId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  const lowId = '00000000-0000-4000-8000-000000000001'
  f.state.rows = [
    f.row('ZZZ101'),
    f.row('BUA201', null, { institutionalId: highId, isFree: true }),
    f.row('BUA201', null, { institutionalId: lowId }),
    f.row('ACC101'),
  ]
  const result = await f.domain.getCurrentStudentCourses()
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.courses.map(course => course.code), ['ACC101', 'BUA201', 'BUA201', 'ZZZ101'])
  assert.deepEqual(result.courses.filter(course => course.code === 'BUA201')
    .map(course => course.institutionalCourseId), [lowId, highId])
  assert.deepEqual(result.courses.map(course => course.content.state),
    ['not-built', 'not-built', 'not-built', 'not-built'])
  assert.equal(result.courses[2].isFree, true)
}))

test('repository level and semester never filter confirmed applicability', async () => fixture(async f => {
  // The fixture's saved selection can represent 300L; BUA201 is statically 200L/first.
  f.state.profile.academic_level_id = f.id.otherLevel
  f.state.profile.academic_period_id = f.id.otherPeriod
  f.state.rows = [f.row('BUA201', 'principles-business-administration')]
  const result = await f.domain.getCurrentStudentCourses()
  assert.equal(result.status, 'complete')
  assert.equal(result.courses.length, 1)
  assert.equal(result.courses[0].content.state, 'ready')
  assert.deepEqual(f.calls.find(call => call[0] === 'applicabilityFilters')[1].slice(1), [
    ['academic_level_id', f.id.otherLevel], ['academic_period_id', f.id.otherPeriod],
  ])
}))

test('a broken content key is reported and never hides or reidentifies its course', async () => fixture(async f => {
  f.state.rows = [f.row('BUA210', 'absent-repository-key')]
  const originalError = console.error
  const errors = []
  console.error = (...args) => errors.push(args)
  try {
    const result = await f.domain.getCurrentStudentCourses()
    assert.equal(result.status, 'complete')
    assert.equal(result.courses.length, 1)
    assert.equal(result.courses[0].code, 'BUA210')
    assert.deepEqual(result.courses[0].content, { state: 'broken-link' })
    assert.equal(errors.length, 1)
    assert.match(errors[0][0], /content link invariant failed/)
    assert.equal(errors[0][1].institutionalCourseId, f.state.rows[0].institutional_course_id)
  } finally {
    console.error = originalError
  }
}))

test('an inaccessible linked registry row remains visible as a broken link', async () => fixture(async f => {
  const linked = f.row('BUA210', 'principles-business-administration')
  linked.institutional.content = null
  f.state.rows = [linked]
  const originalError = console.error
  const errors = []
  console.error = (...args) => errors.push(args)
  try {
    const result = await f.domain.getCurrentStudentCourses()
    assert.equal(result.status, 'complete')
    assert.deepEqual(result.courses[0].content, { state: 'broken-link' })
    assert.equal(errors.length, 1)
  } finally {
    console.error = originalError
  }
}))

test('published read and projection failures stay local to their institutional course', async () => fixture(async f => {
  f.state.rows = [
    f.row('BUA201', 'principles-business-administration', { published: { status: 'unavailable' } }),
    f.row('ACC201', 'financial-accounting-1'),
    f.row('BUA203', 'principles-business-administration', { projectionFails: true }),
  ]
  const result = await f.domain.getCurrentStudentCourses()
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.courses.map(course => course.content.state), ['ready', 'unavailable', 'unavailable'])
}))

test('a session lost during the published read routes signed out', async () => fixture(async f => {
  f.state.rows = [f.row('BUA201', 'principles-business-administration',
    { published: { status: 'signed-out' } })]
  assert.deepEqual(await f.domain.getCurrentStudentCourses(), { status: 'signed-out' })
}))

test('empty published learning does not restore a repository content fallback', async () => fixture(async f => {
  f.state.rows = [f.row('ACC201', 'financial-accounting-1', { learning: {
    overview: null, theoryQuestions: [], quizQuestions: [],
  } })]
  const result = await f.domain.getCurrentStudentCourses()
  assert.deepEqual(result.courses[0].content, { state: 'no-learning' })
}))

test('partial published learning advertises only usable overview, theory and quiz', async () => fixture(async f => {
  f.state.rows = [
    f.row('ACC201', 'financial-accounting-1', { learning: {
      overview: null, theoryQuestions: [{ itemId: randomUUID(), prompt: 'Explain' }], quizQuestions: [],
    } }),
    f.row('ACC202', 'financial-accounting-1', { learning: {
      overview: null, theoryQuestions: [], quizQuestions: [{ section: 'General' }],
    } }),
  ]
  const result = await f.domain.getCurrentStudentCourses()
  assert.deepEqual(result.courses.map(course => course.content.availability), [
    { overview: false, theory: true, quiz: false },
    { overview: false, theory: false, quiz: true },
  ])
}))

test('published CBT without a usable attempt is not presented as a quiz', async () => {
  const course = require('../data/courses.ts').getCourseByContentKey('financial-accounting-1')
  const config = require('../data/quizzes.ts').getQuizConfigurationByCourseSlug(course.slug)
  for (const invalid of [
    { ...config, maxQuizQuestions: 0 },
    { ...config, quizDurationMinutes: 1e308 },
  ]) {
    await fixture(async f => {
      f.state.rows = [f.row('ACC201', 'financial-accounting-1', { learning: {
        overview: null, theoryQuestions: [], quizQuestions: [{ section: 'General' }],
      } })]
      const result = await f.domain.getCurrentStudentCourses()
      assert.deepEqual(result.courses[0].content, { state: 'no-learning' })
    }, { '@/lib/data/quizzes': { getQuizConfigurationByCourseSlug: () => invalid } })
  }
})
