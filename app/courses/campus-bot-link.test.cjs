// app/courses/campus-bot-link.test.cjs — The Campus Bot link on a course row shows only where its page opens. One
// student and one catalogue, read by All Courses, My Courses, Bookmarks and the Campus Bot page itself.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')
const { elementNodes } = require('../../lib/test/element-walker.cjs')

const STUDENT = '21111111-1111-4111-8111-111111111111'
const ENDS = '2027-02-28T22:59:59+00:00'
const uuid = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const reference = (n, label) => ({ id: `1${n}000000-0000-4000-8000-000000000000`, label, isActive: true })
const BUSINESS = reference(1, 'Business Administration'), ACCOUNTING = reference(2, 'Accounting')
const LEVEL_100 = reference(3, '100 Level'), LEVEL_300 = reference(4, '300 Level'), FIRST = reference(5, 'First Semester')
// The student: Business Administration, 100 Level, First Semester.
const mine = { department: BUSINESS, academicLevel: LEVEL_100, academicPeriod: FIRST }
const anotherLevel = { ...mine, academicLevel: LEVEL_300 }
const anotherDepartment = { ...mine, department: ACCOUNTING }

const course = (n, code, title, applicability, extra = {}) => ({ institutionalCourseId: uuid(n), code, title, isFree: false,
  applicability, repository: { state: 'unlinked' }, content: { state: 'not-built', reason: 'unlinked' }, ...extra })
const shelved = slug => ({ state: 'shelved', repositoryCourseId: `${slug}-repository`, contentKey: `${slug}-key`,
  isShared: false, route: { slug, href: `/courses/${slug}`, course: { slug, code: slug, title: `${slug} shelf title` } } })
const study = flags => ({ notes: false, cbtPractice: false, theory: false, overview: false, ...flags })
// On the student's list, without materials: one free course and one their plan would cover.
const GST102 = course(7, 'GST102', 'Philosophy and Logic', [mine, anotherDepartment], { isFree: true })
const BUA102 = course(12, 'BUA102', 'Principles of Management', [mine])
// Outside it, without materials: another level, another department, and a free course of another level.
const BUA302 = course(145, 'BUA302', 'Organisational Behaviour', [anotherLevel])
const ACC101 = course(31, 'ACC101', 'Principles of Accounting', [anotherDepartment])
const GST302 = course(21, 'GST302', 'Entrepreneurship', [anotherLevel], { isFree: true })
// On the list with materials: its row opens the course itself, and nothing is asked about it.
const GST111 = course(3, 'GST111', 'Use of English', [mine, anotherDepartment], { isFree: true,
  repository: shelved('use-of-english'), content: { state: 'ready', study: study({ notes: true }) } })
const WITHOUT_MATERIALS = [GST102, BUA102, BUA302, ACC101, GST302]

// What get_my_course_access answers. A free course is answered before the student's list is looked at.
const decision = (item, reason, extra = {}) => ({ institutional_course_id: item.institutionalCourseId, reason,
  allowed: ['free', 'operator', 'own-list', 'team-added'].includes(reason), on_list: false, team_added: false,
  ends_at: null, ...extra })
// A 100 Level student with no plan, whose courses are confirmed for the semester.
const decisions = () => new Map([decision(GST102, 'free'), decision(BUA102, 'needs-plan', { on_list: true }),
  decision(BUA302, 'outside-list'), decision(ACC101, 'outside-list'), decision(GST302, 'free')]
  .map(row => [row.institutional_course_id, row]))

// A question set the student made from their notes, as ai_practice_generations stores it.
const storedSet = { formatVersion: 1, origin: 'ai-generated', visibility: 'personal', verification: 'unverified',
  source: { fileName: 'behaviour-notes.pdf' }, questions: [{ id: `ai_${'0'.repeat(24)}`, prompt: 'What is a group norm?',
    options: ['A shared rule', 'A job title', 'A pay grade', 'A deadline'], correctOption: 0,
    explanation: 'The notes define a norm as a rule the group shares.', section: 'Groups',
    grounding: { documentId: uuid(900), sourceSha256: 'a'.repeat(64), passageId: 'P1', passageStart: 0, passageEnd: 48,
      quote: 'A norm is a rule of behaviour the group shares.' } }] }
const generation = (item, extra = {}) => ({ id: uuid(800), user_id: STUDENT, status: 'generated',
  institutional_course_id: item.institutionalCourseId, created_at: '2026-11-10T09:00:00.000Z',
  expires_at: '2999-01-01T00:00:00.000Z', question_set: storedSet, ...extra })

const linkTo = item => `href="/courses/ai-practice/${item.institutionalCourseId}"`
const linked = rows => [...rows].filter(([, html]) => html.includes('href="/courses/ai-practice/')).map(([code]) => code).sort()

/** The student's cookie-bound client: the access answer, their stored sets and nothing else. */
function studentClient(state) {
  return {
    rpc: async (name, args) => {
      if (name === 'get_my_ai_allowance') return { data: { state: 'not-entitled', total: 0, used: 0 }, error: null }
      assert.equal(name, 'get_my_course_access')
      const ids = args.p_institutional_course_ids
      state.reads.push(`access ${ids.length}`)
      return state.accessFails ? { data: null, error: { code: 'XX000', message: 'private provider detail' } }
        : { data: ids.map(id => state.decisions.get(id)), error: null }
    },
    from: table => {
      assert.equal(table, 'ai_practice_generations')
      const filters = new Map()
      let limit = Infinity
      const query = {
        select: () => query, order: () => query,
        eq: (column, value) => { filters.set(column, value); return query },
        gt: (column, value) => { assert.equal(column, 'expires_at'); filters.set('after', value); return query },
        limit: count => { limit = count; return query },
        then: (resolve, reject) => {
          const one = filters.get('institutional_course_id')
          state.reads.push(one ? `sets of ${one}` : 'courses with sets')
          if (state.setsFail) throw new Error('private provider detail')
          return Promise.resolve({ error: null, data: state.generations.filter(row => row.user_id === filters.get('user_id') &&
            row.status === filters.get('status') && row.expires_at > filters.get('after') &&
            (one === undefined || row.institutional_course_id === one)).slice(0, limit) }).then(resolve, reject)
        },
      }
      return query
    },
  }
}

async function fixture(run) {
  return withTsx(async () => {
    const original = Module._load, environment = { ...process.env }
    const local = relative => path.join(__dirname, '../..', relative)
    const user = { id: STUDENT }
    const fresh = () => ({ catalogue: [ACC101, BUA102, BUA302, GST102, GST111, GST302], decisions: decisions(),
      generations: [], profile: { status: 'complete', revision: 1, firstName: 'Ada', options: {}, selection: mine },
      bookmarkable: new Map(), accessFails: false, setsFail: false, reads: [] })
    const state = fresh()
    const client = studentClient(state)
    function StudentAccessGate() { return null }
    function AiPracticeClient() { return null }
    function BookmarksClient() { return null }
    Object.assign(process.env, { AI_PRACTICE_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-ant-test' })
    try {
      Module._load = function(name, ...args) {
        if (name === 'next/navigation') return { notFound: () => { throw new Error('notFound') },
          redirect: destination => { throw new Error('redirect:' + destination) } }
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === '@/components/auth/AuthFlowSync') return { AuthFlowSync: function AuthFlowSync() { return null } }
        if (name === '@/lib/supabase/server') return { createClient: async () => client }
        if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => true }
        if (name === '@/lib/auth/account-continuity') return { issueAccountContinuityToken: () => 'page-token' }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async (_, supplied) => {
          assert.equal(supplied, client); return { user, sessionId: 'live-session' }
        } }
        if (name === '@/lib/profile/student-profile') return { getCurrentStudentProfileForVerifiedStudent: async (supplied, owner) => {
          assert.equal(supplied, client); assert.equal(owner, user); return state.profile
        } }
        if (name === '@/lib/entitlements/server') return { readPlansOnSale: async () => false,
          readEntitlementForVerifiedStudent: async () => ({ status: 'unavailable' }) }
        if (name === '@/lib/practice/progress') return { readPracticeProgress: async () => ({ status: 'unavailable' }) }
        if (name === '@/lib/data/courses') return { courses: [...state.bookmarkable.keys()].map(slug => ({ slug })),
          getCourseBySlug: () => undefined, getCourseByContentKey: () => undefined }
        if (name === '@/lib/courses/read-model') return {
          // The real predicates; only the verified reads are the fixture's.
          ...original.call(this, local('lib/courses/read-model.ts'), ...args),
          getStudentCatalogueForVerifiedStudent: async () => ({ status: 'ok', courses: state.catalogue }),
          getStudentCourseByIdForVerifiedStudent: async (_, id) => ({ status: 'ok',
            course: state.catalogue.find(item => item.institutionalCourseId === id) }),
          // My Courses lists the saved selection's courses, each with that one offering.
          getCurrentStudentCoursesForVerifiedStudent: async () => ({ status: 'ok', cbtBankSizes: new Map(),
            selection: { departmentId: mine.department.id, academicLevelId: mine.academicLevel.id,
              academicPeriodId: mine.academicPeriod.id },
            courses: state.catalogue.filter(item => item.applicability.includes(mine))
              .map(item => ({ ...item, applicability: [mine] })) }),
          getStudentCourseBySlugForVerifiedStudent: async (_, slug) => state.bookmarkable.get(slug),
        }
        if (name === './AiPracticeClient') return { AiPracticeClient }
        if (name === './BookmarksClient') return { BookmarksClient }
        return original.call(this, name, ...args)
      }
      const under = element => element.type(element.props)
      const rowsOf = html => new Map([...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)]
        .map(([, row]) => [/student-course-row-code">([^<]+)</.exec(row)[1], row]))
      await run({ state, reset: () => Object.assign(state, fresh()),
        /** All Courses: every course's row by its code, whichever page of the list it is on. */
        allCourses: async () => {
          const tree = await under(require('./page.tsx').default().props.children)
          const directory = elementNodes(tree).find(node => node.type?.name === 'CourseDirectory')
          return new Map(directory.props.items.map(item => [item.code, renderToStaticMarkup(item.row)]))
        },
        myCourses: async () => rowsOf(renderToStaticMarkup(await require('../my-courses/page.tsx').default())),
        /** Bookmarks: the row each bookmarkable course would show, by its route. */
        bookmarks: async () => {
          const tree = await under(require('../bookmarks/page.tsx').default().props.children)
          const { catalog } = elementNodes(tree).find(node => node.type === BookmarksClient).props
          return new Map(catalog.map(item => [item.slug, item.row]))
        },
        /** Whether the Campus Bot page opens for a course, rather than sending the student back to My Courses. */
        opens: async item => {
          const page = require('./ai-practice/[courseId]/page.tsx').default
          const gated = await page({ params: Promise.resolve({ courseId: item.institutionalCourseId }) })
          try {
            const tree = await under(gated.props.children('page-token'))
            assert.equal(elementNodes(tree).filter(node => node.type === AiPracticeClient).length, 1, `${item.code} shows Campus Bot`)
            return true
          } catch (error) {
            if (error.message !== 'redirect:/my-courses') throw error
            return false
          }
        } })
    } finally {
      Module._load = original
      for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key]
      Object.assign(process.env, environment)
    }
  })
}

test('All Courses: only missing-material courses where Campus Bot opens have a plain row target', async () => fixture(async f => {
  const rows = await f.allCourses()
  assert.deepEqual([...rows.keys()], ['ACC101', 'BUA102', 'BUA302', 'GST102', 'GST111', 'GST302'])
  for (const item of WITHOUT_MATERIALS) {
    const allowed = item === GST102 || item === BUA102
    assert.equal(rows.get(item.code).includes(linkTo(item)), allowed)
    assert.match(rows.get(item.code), /No study materials yet/)
    assert.doesNotMatch(rows.get(item.code), /student-ai-practice-link|Campus Bot|Practise from your notes|underline/)
    assert.equal((rows.get(item.code).match(/<a\b/g) ?? []).length, allowed ? 1 : 0)
  }
  assert.deepEqual(linked(rows), ['BUA102', 'GST102'])
  assert.deepEqual(f.state.reads, ['access 5', 'courses with sets'], 'one batched access read and one look for kept sets')
}))

// Each situation, and the rows that carry the link in it.
const SITUATIONS = [
  ['no plan yet', () => {}, ['BUA102', 'GST102']],
  ['a plan that covers their list', f => f.state.decisions.set(BUA102.institutionalCourseId,
    decision(BUA102, 'own-list', { on_list: true, ends_at: ENDS })), ['BUA102', 'GST102']],
  // The database answers every paid course "needs-selection" before it looks at the list.
  ['their courses need confirming for the semester', f => {
    for (const item of [BUA102, BUA302, ACC101]) f.state.decisions.set(item.institutionalCourseId, decision(item, 'needs-selection'))
  }, ['GST102']],
  ['the semester has no calendar yet', f => {
    for (const item of [BUA102, BUA302, ACC101]) f.state.decisions.set(item.institutionalCourseId, decision(item, 'missing-calendar'))
  }, ['GST102']],
  ['a course the team added to their plan', f => f.state.decisions.set(ACC101.institutionalCourseId,
    decision(ACC101, 'team-added', { team_added: true, ends_at: ENDS })), ['ACC101', 'BUA102', 'GST102']],
  ['a course the team added, with no plan to open it', f => f.state.decisions.set(ACC101.institutionalCourseId,
    decision(ACC101, 'needs-plan', { team_added: true })), ['BUA102', 'GST102']],
  ['question sets kept for a course that has left their list', f => { f.state.generations = [generation(BUA302)] },
    ['BUA102', 'BUA302', 'GST102']],
  ['a kept set that can no longer be read', f => {
    f.state.generations = [generation(BUA302, { question_set: { ...storedSet, formatVersion: 0 } })]
  }, ['BUA102', 'GST102']],
  ['a set that has expired', f => { f.state.generations = [generation(BUA302, { expires_at: '2026-01-01T00:00:00.000Z' })] },
    ['BUA102', 'GST102']],
  ['another student’s set', f => { f.state.generations = [generation(BUA302, { user_id: uuid(999) })] }, ['BUA102', 'GST102']],
  ['an operator', f => {
    for (const item of [BUA102, BUA302, ACC101]) f.state.decisions.set(item.institutionalCourseId, decision(item, 'operator'))
  }, ['BUA102', 'GST102']],
  ['a saved selection that cannot be read', f => { f.state.profile = { status: 'unavailable' } }, ['BUA102']],
  ['an access read that fails', f => { f.state.accessFails = true }, []],
  ['an access read that fails, with a kept set', f => { f.state.accessFails = true; f.state.generations = [generation(GST302)] },
    ['GST302']],
]

test('a plain Campus Bot row links exactly where its page opens for the student', async t => fixture(async f => {
  for (const [situation, arrange, expected] of SITUATIONS) {
    await t.test(situation, async () => {
      f.reset()
      arrange(f)
      const rows = await f.allCourses()
      assert.deepEqual(linked(rows), expected)
      const opened = []
      for (const item of WITHOUT_MATERIALS) {
        const shown = rows.get(item.code).includes(linkTo(item))
        assert.match(rows.get(item.code), /No study materials yet/)
        assert.doesNotMatch(rows.get(item.code), /Practise from your notes|Campus Bot|student-ai-practice-link/)
        const opens = await f.opens(item)
        assert.equal(opens, shown, `${item.code}: only link where the page opens`)
        if (opens) opened.push(item.code)
      }
      assert.deepEqual(opened.sort(), expected)
    })
  }
}))

test('My Courses: a missing-material course has no link while its Campus Bot page would redirect', async () => fixture(async f => {
  f.state.decisions.set(BUA102.institutionalCourseId, decision(BUA102, 'needs-selection'))
  let rows = await f.myCourses()
  assert.deepEqual([...rows.keys()], ['BUA102', 'GST102', 'GST111'])
  assert.match(rows.get('BUA102'), /No study materials yet/)
  assert.doesNotMatch(rows.get('BUA102'), /<a\b|Campus Bot/)
  assert.ok(rows.get('GST102').includes(linkTo(GST102)))
  assert.deepEqual(f.state.reads, ['access 2', 'courses with sets'])
  assert.equal(await f.opens(BUA102), false)
  assert.equal(await f.opens(GST102), true)
  f.state.decisions = decisions()
  f.state.reads.length = 0
  rows = await f.myCourses()
  assert.deepEqual(linked(rows), ['BUA102', 'GST102'])
  assert.ok(rows.get('BUA102').includes(linkTo(BUA102)))
  assert.deepEqual(f.state.reads, ['access 2'], 'covered courses need no kept-set read')
}))

test('Bookmarks: every missing-material row opens its course page without an inline Campus Bot link', async () => fixture(async f => {
  // Course pages remain the row destination even outside the student’s Campus Bot list.
  const empty = { state: 'no-published-learning', study: study({}) }
  const saved = (item, slug) => [slug, { status: 'ok', learning: null, practice: null,
    course: { ...item, repository: shelved(slug), content: empty } }]
  f.state.decisions.set(BUA102.institutionalCourseId, decision(BUA102, 'own-list', { on_list: true, ends_at: ENDS }))
  f.state.bookmarkable = new Map([saved(GST102, 'philosophy-and-logic'), saved(BUA102, 'principles-of-management'),
    saved(GST302, 'entrepreneurship'), ['use-of-english', { status: 'ok', course: GST111, learning: null, practice: null }],
    ['old-shelf', { status: 'repository-only', learning: null, practice: null,
      course: { repository: shelved('old-shelf'), content: empty } }]])
  const rows = await f.bookmarks()
  assert.deepEqual(rows.get('philosophy-and-logic'), { code: 'GST102', title: 'Philosophy and Logic', unavailable: 'missing',
    href: '/courses/philosophy-and-logic' })
  assert.deepEqual(rows.get('principles-of-management'), { code: 'BUA102', title: 'Principles of Management',
    unavailable: 'missing', href: '/courses/principles-of-management' })
  assert.deepEqual(rows.get('entrepreneurship'), { code: 'GST302', title: 'Entrepreneurship', unavailable: 'missing', href: '/courses/entrepreneurship' },
    'a free course of another level is outside their list')
  assert.equal(rows.get('use-of-english').href, '/courses/use-of-english')
  assert.deepEqual(rows.get('old-shelf'), { repositoryOnly: true, title: 'old-shelf shelf title', unavailable: 'missing', href: '/courses/old-shelf' })
  assert.deepEqual(f.state.reads, ['access 3', 'courses with sets'])
}))

test('a list with no row that could carry the link reads nothing more', async () => fixture(async f => {
  f.state.catalogue = [GST111]
  assert.deepEqual(linked(await f.allCourses()), [])
  assert.deepEqual(f.state.reads, [])
  // With Campus Bot switched off no row carries the link, whatever the student's list.
  f.state.catalogue = [GST102, BUA102, BUA302]
  delete process.env.AI_PRACTICE_ENABLED
  assert.deepEqual(linked(await f.allCourses()), [])
  assert.deepEqual(linked(await f.myCourses()), [])
  assert.deepEqual(f.state.reads, [])
}))

test('a large catalogue batches access reads and links only covered courses or readable kept sets', async () => fixture(async f => {
  const others = Array.from({ length: 199 }, (_, index) => course(1000 + index, `OUT${index}`, `Outside ${index}`, [anotherLevel]))
  for (const item of others) f.state.decisions.set(item.institutionalCourseId, decision(item, 'outside-list'))
  f.state.catalogue = [GST102, BUA102, ...others]
  f.state.generations = [generation(others[198]), generation(BUA102, { id: uuid(801) })]
  const rows = await f.allCourses()
  assert.equal(rows.size, 201)
  assert.deepEqual(linked(rows), ['BUA102', 'GST102', 'OUT198'])
  assert.ok(rows.get('OUT198').includes(linkTo(others[198])))
  assert.deepEqual(f.state.reads, ['access 200', 'access 1', 'courses with sets', `sets of ${others[198].institutionalCourseId}`])
}))

test('a read that breaks shows no link and leaves the list as it was', async () => fixture(async f => {
  f.state.setsFail = true
  const rows = await f.allCourses()
  assert.equal(rows.size, 6)
  assert.deepEqual(linked(rows), [])
  assert.doesNotMatch([...rows.values()].join(''), /private provider detail/)
}))
