const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')

function nodes(element) {
  if (!element || typeof element !== 'object') return []
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
}

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
  const state = { enabled: true, user: { id: 'student', email: 'student@example.test' }, profile: { status: 'incomplete', options }, reads: 0 }
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
      if (name === '@/lib/profile/student-profile') return { getCurrentStudentProfile: async () => {
        state.reads++
        return state.profile
      } }
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
  assert.equal(page.props.title, 'Profile selection')
  assert.equal(page.props.children[1].type.name, 'ProfileSelectionForm')
  assert.equal(page.props.children[1].props.continuityToken, 'page:student:fixture-session')
  f.state.profile = { status: 'complete', options, selection }
  const account = await f.account()
  assert.equal(account.props.title, 'Account')
  const link = nodes(account).find(node => node.props?.children === 'Change selection')
  assert.equal(link.props.href, '/profile-selection')
  page = await f.selectionPage()
  assert.equal(page.props.title, 'Change selection')
  assert.equal(page.props.children[1].props.initial.status, 'complete')
}))

test('auth and selection redirects terminate, including a completed student opening the change path', async () => fixture(async f => {
  await assert.rejects(f.signedOutGate({ children: 'login form' }), /redirect:\/account/)
  await assert.rejects(f.account, /redirect:\/profile-selection/)
  assert.equal((await f.selectionPage()).props.children[1].props.initial.status, 'incomplete')
  f.state.profile = { status: 'complete', options, selection }
  assert.equal((await f.account()).props.title, 'Account')
  assert.equal((await f.selectionPage()).props.title, 'Change selection')
  const { getSafeReturnPath } = require('../../lib/auth/redirect.ts')
  assert.equal(getSafeReturnPath('/profile-selection'), '/profile-selection')
  assert.ok(require('../../proxy.ts').config.matcher.includes('/profile-selection'))
}))

test('missing, invariant, unavailable and disabled states remain controlled', async () => fixture(async f => {
  for (const [status, expected] of [
    ['missing-profile', 'could not be found'],
    ['invariant-failure', 'needs attention'],
    ['unavailable', 'Something went wrong'],
  ]) {
    f.state.profile = { status }
    assert.match(nodes(await f.account()).find(node => node.type?.name === 'Feedback').props.message, new RegExp(expected))
    assert.match(nodes(await f.selectionPage()).find(node => node.type?.name === 'Feedback').props.message, new RegExp(expected))
  }
  f.state.enabled = false
  const reads = f.state.reads
  assert.equal((await f.account()).props.children.type.name, 'AuthUnavailable')
  assert.equal((await f.selectionPage()).props.children.type.name, 'AuthUnavailable')
  assert.equal(f.state.reads, reads)
}))
