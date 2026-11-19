const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const { elementNodes } = require('../../lib/test/element-walker.cjs')


const nodes = element => elementNodes(element)
// The words of a message that may hold a link (Reload, Help & Support), without rendering it.
const textOf = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : ''
const COURSES_UNREADABLE = 'We couldn’t load your courses. Reload'
const hrefsOf = node => nodes(node).filter(element => typeof element.props?.href === 'string').map(element => element.props.href)

const options = {
  departments: [{ id: 'dept', label: 'Fixture department' }],
  academicLevels: [{ id: 'level', label: 'Fixture level' }],
  academicPeriods: [{ id: 'period', label: 'Fixture semester' }],
}
const selection = {
  department: { id: 'dept', label: 'Fixture department', isActive: true },
  academicLevel: { id: 'level', label: 'Fixture level', isActive: true },
  academicPeriod: { id: 'period', label: 'Fixture semester', isActive: true },
}

async function fixture(run) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const files = [
    require.resolve('../account/page.tsx'), require.resolve('./page.tsx'),
    require.resolve('../../components/auth/SignedOutGate.tsx'),
  ]
  const state = { courses: { state: 'incomplete', locked: false, lastDay: null }, plan: { status: 'ok', entitlement: { tier: 'free', trial: { status: 'available' } } }, enabled: true, user: { id: 'student', email: 'student@example.test' }, deletionAllowed: true, profile: { status: 'incomplete', revision: 0, firstName: null, options }, reads: 0 }
  const redirect = path => { throw new Error('redirect:' + path) }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'next/navigation') return { redirect }
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => state.enabled }
      if (name === '@/lib/auth/account-continuity') return {
        issueAccountContinuityToken: (userId, sessionId) => `page:${userId}:${sessionId}`,
      }
      if (name === '@/lib/auth/student-state') return {
        getStudentSessionUser: async () => state.user,
        getStudentSessionContext: async () => state.user === null ? null : { user: state.user, sessionId: 'fixture-session' },
        hasStudentSession: async () => state.user !== null,
      }
      if (name === '@/lib/supabase/server') return { createClient: async () => {
        if (state.clientError) throw new Error('read transport unavailable')
        return { fixture: 'verified client' }
      } }
      if (name === '@/lib/profile/course-selection') return { readCourseSelection: async () => state.courses }
      if (name === '@/lib/entitlements/server') return { readEntitlementForVerifiedStudent: async () => state.plan }
      if (name === '@/lib/account/lifecycle') return { readAccountLifecycle: async () => ({ status: 'active', deletionAllowed: state.deletionAllowed }) }
      if (name === '@/lib/profile/student-profile') {
        const read = async () => { state.reads++; return state.profile }
        return { getCurrentStudentProfile: read, getCurrentStudentProfileForVerifiedStudent: read }
      }
      return originalLoad.call(this, name, ...args)
    }
    for (const file of files) delete require.cache[file]
    await run({ state, account: require(files[0]).default, selectionPage: require(files[1]).default,
      signedOutGate: require(files[2]).SignedOutGate })
  } finally {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    for (const file of files) delete require.cache[file]
  }
}

test('signed-out entry points retain Auth redirects without reading the account profile', async () => fixture(async f => {
  f.state.user = null
  await assert.rejects(f.account, /redirect:\/login\?next=%2Faccount/)
  assert.equal(f.state.reads, 0)
  f.state.profile = { status: 'signed-out' }
  await assert.rejects(f.selectionPage, /redirect:\/login\?next=%2Fprofile-selection/)
  assert.equal(f.state.reads, 0)
  assert.equal((await f.signedOutGate({ children: 'login form' })).props.children.length, 2)
}))

test('incomplete account reaches selection; completed account stays and offers intentional editing', async () => fixture(async f => {
  await assert.rejects(f.account, /redirect:\/profile-selection/)
  let page = await f.selectionPage()
  assert.equal(page.props.title, 'Edit profile')
  assert.equal(page.props.description, 'Set up your profile to see your courses.', 'a new student is told what the form is for, once')
  assert.equal(page.props.children[1].type.name, 'ProfileSelectionForm')
  assert.equal(page.props.children[1].props.continuityToken, 'page:student:fixture-session')
  f.state.profile = { status: 'complete', revision: 0, firstName: 'Adaeze', options, selection }
  const account = await f.account()
  assert.equal(nodes(account).find(node => node.type?.name === 'StudentPage').props.band.props.title, 'Profile')
  // The section is headed "Academic details", so its one button is just "Edit".
  const link = nodes(account).find(node => node.props?.children === 'Edit')
  assert.equal(link.props.href, '/profile-selection')
  page = await f.selectionPage()
  assert.equal(page.props.title, 'Edit profile', 'one title whatever the account state')
  assert.equal(page.props.description, undefined, 'the labelled fields need no line above them')
  assert.equal(page.props.children[1].props.initial.status, 'complete')
}))

test('account and profile error links use shared secondary button focus', async () => fixture(async f => {
  const check = link => {
    const actual = new Set(link.props.className.split(/\s+/))
    for (const token of ['min-h-11', 'px-4', 'py-2', 'text-[14px]', 'border-student-border-strong',
      'bg-transparent', 'student-focus-control']) {
      assert.ok(actual.has(token), `missing action style ${token}`)
    }
    for (const token of ['border-transparent', 'px-5', 'py-2.5', 'text-[15px]']) assert.equal(actual.has(token), false)
    assert.equal(actual.has('underline'), false)
  }
  f.state.profile = { status: 'complete', revision: 0, firstName: 'Adaeze', options, selection }
  check(nodes(await f.account()).find(node => node.props?.children === 'Edit'))
  f.state.profile = { status: 'unavailable' }
  check(nodes(await f.selectionPage()).find(node => node.props?.children === 'Back to profile'))
}))

test('auth and selection redirects terminate, including a completed student opening the change path', async () => fixture(async f => {
  await assert.rejects(f.signedOutGate({ children: 'login form' }), /redirect:\/dashboard/)
  await assert.rejects(f.account, /redirect:\/profile-selection/)
  assert.equal((await f.selectionPage()).props.children[1].props.initial.status, 'incomplete')
  f.state.profile = { status: 'complete', revision: 0, firstName: 'Adaeze', options, selection }
  assert.equal(nodes(await f.account()).find(node => node.type?.name === 'StudentPage').props.band.props.title, 'Profile')
  assert.equal((await f.selectionPage()).props.title, 'Edit profile')
  const { getSafeReturnPath } = require('../../lib/auth/redirect.ts')
  assert.equal(getSafeReturnPath('/profile-selection'), '/profile-selection')
  const { unstable_doesMiddlewareMatch } = require('next/experimental/testing/server')
  assert.ok(unstable_doesMiddlewareMatch({ config: require('../../proxy.ts').config, nextConfig: {}, url: '/profile-selection' }))
}))

test('missing, invariant, unavailable and disabled states remain controlled', async () => fixture(async f => {
  // Both pages say it in the app's one way ("We couldn’t …"); the Profile page adds the way to Help & Support.
  for (const [status, onAccount, onForm] of [
    ['missing-profile', 'We couldn’t find your profile. Help & Support', 'We couldn’t find your profile'],
    ['invariant-failure', 'We couldn’t load your profile. Help & Support', 'We couldn’t load your profile'],
    ['unavailable', "We couldn't complete your request", "We couldn't complete your request"],
  ]) {
    f.state.profile = { status }
    for (const [page, expected] of [[await f.account(), onAccount], [await f.selectionPage(), onForm]]) {
      const message = nodes(page).find(node => node.type?.name === 'Feedback').props.message
      assert.ok(textOf(message).includes(expected), `${status}: ${textOf(message)}`)
      // A profile only support can fix links to support, in the message itself.
      assert.deepEqual(hrefsOf(message), status === 'unavailable' ? [] : ['/contact'], status)
    }
  }
  f.state.enabled = false
  const reads = f.state.reads
  assert.equal(nodes(await f.account()).find(node => node.type?.name === 'AuthUnavailable')?.type.name, 'AuthUnavailable')
  assert.equal(nodes(await f.selectionPage()).find(node => node.type?.name === 'AuthUnavailable')?.type.name, 'AuthUnavailable')
  assert.equal(f.state.reads, reads)
}))

test('Profile uses the Student App band and shows real personal/academic details, sign out and student deletion', async () => fixture(async f => {
  f.state.profile = { status: 'complete', revision: 0, firstName: 'Adaeze', options, selection }
  const account = await f.account()
  const workspace = nodes(account).find(node => node.type?.name === 'StudentPage')
  const frame = workspace.type(workspace.props), frameNodes = nodes(frame)
  assert.equal(frame.props['data-student-app'], true)
  const band = workspace.props.band
  const bandNodes = nodes(band.type(band.props))
  assert.equal(bandNodes.find(node => node.type === 'h1')?.props.children, 'Profile', 'the page is named as its tab is')
  assert.equal(band.props.lede, undefined, 'the sections say what the page holds; no line repeats it')
  assert.equal(bandNodes.find(node => node.props?.children === 'Dashboard')?.props.href, '/dashboard')
  const sections = frameNodes.filter(node => node.type === 'section')
  // Signing out has no heading: its line and its button say it.
  assert.deepEqual(sections.map(section => nodes(section).find(node => node.type === 'h2')?.props.children),
    ['Personal details', 'Academic details', 'Plan & Access', undefined])
  assert.ok(frameNodes.some(node => node.type?.name === 'DeleteAccountForm'))
  assert.match(nodes(account).find(node => node.props?.className?.includes('tablet:grid-cols-['))?.props.className,
    /desktop:gap-6/)
  assert.deepEqual(nodes(sections[0]).filter(node => node.type === 'dt').map(node => node.props.children), ['First name', 'Email'])
  assert.deepEqual(nodes(sections[0]).filter(node => node.type === 'dd').map(node => node.props.children), ['Adaeze', 'student@example.test'])
  const summary = nodes(sections[1]).find(node => node.type?.name === 'SelectionSummary')
  assert.equal(summary?.props.selection, selection)
  const summaryRows = nodes(summary.type(summary.props))
  assert.deepEqual(summaryRows.filter(node => node.type === 'dt').map(node => node.props.children), ['Department', 'Level', 'Semester'])
  assert.deepEqual(summaryRows.filter(node => node.type === 'dd').map(node => node.props.children[0]),
    ['Fixture department', 'Fixture level', 'Fixture semester'])
  assert.equal(nodes(sections[1]).find(node => node.props?.children === 'Edit')?.props.href, '/profile-selection')
  assert.equal(nodes(sections[2]).find(node => node.props?.children === 'View your plan')?.props.href, '/access')
  // Each card holds its heading and its one action; no sentence explains the email, the plan card or the page.
  assert.deepEqual(nodes(sections[0]).filter(node => node.type === 'p'), [])
  assert.deepEqual(nodes(sections[2]).filter(node => node.type === 'p'), [])
  assert.equal(sections[3].props['aria-label'], 'Sign out')
  assert.deepEqual(nodes(sections[3]).filter(node => node.type === 'p').map(node => node.props.children),
    ['Sign out of CampusIntell on this device.'])
  assert.ok(nodes(sections[3]).some(node => node.type?.name === 'LogoutButton'))
  const { metadata } = require('../account/page.tsx')
  assert.equal(metadata.title, 'Profile | CampusIntell')
  f.state.deletionAllowed = false
  const operator = await f.account()
  assert.equal(nodes(operator).some(node => node.type?.name === 'DeleteAccountForm'), false, 'operator presentation offers no ordinary deletion')
  const last = nodes(operator).filter(node => node.type === 'section').at(-1)
  assert.equal(textOf(last), 'This account can’t be deleted here. Message us for help.')
  assert.deepEqual(hrefsOf(last), ['/contact'])
}))

test('Profile selection uses the student workspace for incomplete, complete and error states', async () => fixture(async f => {
  let page = await f.selectionPage()
  let frame = page.type(page.props)
  assert.match(frame.props.className, /app-container student-workspace student-page/)
  assert.equal(nodes(frame).find(node => node.type === 'h1')?.props.children, 'Edit profile')
  assert.equal(nodes(page).find(node => node.type?.name === 'ProfileSelectionForm')?.props.initial.status, 'incomplete')
  f.state.profile = { status: 'complete', revision: 0, firstName: 'Adaeze', options, selection }
  page = await f.selectionPage()
  assert.equal(page.props.title, 'Edit profile')
  assert.equal(nodes(page).find(node => node.type?.name === 'ProfileSelectionForm')?.props.initial.selection, selection)
  f.state.profile = { status: 'unavailable' }
  page = await f.selectionPage()
  assert.match(nodes(page).find(node => node.props?.className?.includes('student-surface'))?.props.className,
    /student-surface/)
  assert.equal(nodes(page).some(node => node.type?.name === 'ProfileSelectionForm'), false)
}))


test('an unknown course lock withholds the form and asks for a refresh', async () => fixture(async f => {
  for (const status of ['incomplete', 'complete']) {
    f.state.profile = { status, revision: 0, firstName: 'Adaeze', options, ...(status === 'complete' ? { selection } : {}) }
    f.state.courses = null
    const page = await f.selectionPage()
    assert.equal(nodes(page).some(node => node.type?.name === 'ProfileSelectionForm'), false)
    const message = nodes(page).find(node => node.type?.name === 'Feedback')?.props.message
    assert.equal(textOf(message), COURSES_UNREADABLE)
    assert.deepEqual(hrefsOf(message), ['/profile-selection'])
  }
}))

test('an unknown plan cannot allow a first pick without knowing whether it will lock', async () => fixture(async f => {
  for (const status of ['unavailable', 'signed-out']) {
    f.state.plan = { status }
    const page = await f.selectionPage()
    assert.equal(nodes(page).some(node => node.type?.name === 'ProfileSelectionForm'), false)
    assert.equal(textOf(nodes(page).find(node => node.type?.name === 'Feedback')?.props.message), COURSES_UNREADABLE)
  }
  f.state.plan = { status: 'ok', entitlement: { tier: 'full', trial: { status: 'unavailable' } } }
  assert.equal(nodes(await f.selectionPage()).find(node => node.type?.name === 'ProfileSelectionForm')?.props.mode, 'first-pick',
    'a known active plan still shows the first-pick warning')
}))

test('locked courses keep the one title, with no line under it, and the form in its locked mode', async () => fixture(async f => {
  f.state.profile = { status: 'complete', revision: 0, firstName: 'Adaeze', options, selection }
  f.state.courses = { state: 'locked', locked: true, lastDay: '2027-03-08' }
  const page = await f.selectionPage()
  assert.equal(page.props.title, 'Edit profile')
  assert.equal(page.props.description, undefined)
  assert.equal(nodes(page).find(node => node.type?.name === 'ProfileSelectionForm')?.props.mode, 'locked')
}))


test('a thrown course-read setup failure also withholds the form', async () => fixture(async f => {
  f.state.clientError = true
  const page = await f.selectionPage()
  assert.equal(nodes(page).some(node => node.type?.name === 'ProfileSelectionForm'), false)
  assert.equal(textOf(nodes(page).find(node => node.type?.name === 'Feedback')?.props.message), COURSES_UNREADABLE)
}))
