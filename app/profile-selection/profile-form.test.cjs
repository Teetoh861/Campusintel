const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')

function nodes(element) {
  if (!element || typeof element !== 'object') return []
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
}

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

async function fixture(run, complete = false) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const oldFetch = global.fetch
  const oldWindow = global.window
  const file = require.resolve('./ProfileSelectionForm.tsx')
  const ids = { department: randomUUID(), secondDepartment: randomUUID(), level: randomUUID(),
    period: randomUUID(), secondPeriod: randomUUID(), inactive: randomUUID() }
  const options = {
    departments: [{ id: ids.secondDepartment, label: 'Zeta unit' }, { id: ids.department, label: 'Alpha unit' }],
    academicLevels: [{ id: ids.level, label: 'Stage Q' }],
    academicPeriods: [{ id: ids.period, label: 'Term R' }, { id: ids.secondPeriod, label: 'Term S' }],
  }
  const selection = {
    department: { id: ids.department, label: 'Alpha unit', isActive: true },
    academicLevel: { id: ids.level, label: 'Stage Q', isActive: true },
    academicPeriod: { id: ids.period, label: 'Term R', isActive: true },
  }
  const initial = complete ? { status: 'complete', options, selection } : { status: 'incomplete', options }
  const state = [], refs = [], effectDeps = [], effects = [], requests = [], navigations = []
  let stateIndex = 0, refIndex = 0, effectIndex = 0
  let pageToken = 'page:fixture-student'
  let responder = async () => response(503, { status: 'unavailable' })
  const hooks = {
    ...React,
    useState(value) {
      const index = stateIndex++
      if (!(index in state)) state[index] = typeof value === 'function' ? value() : value
      return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useRef(value) {
      const index = refIndex++
      if (!(index in refs)) refs[index] = { current: value }
      return refs[index]
    },
    useEffect(effect, nextDeps) {
      const index = effectIndex++
      const previous = effectDeps[index]
      if (!previous || nextDeps.some((value, i) => !Object.is(value, previous[i]))) {
        effectDeps[index] = nextDeps
        effects.push(effect)
      }
    },
  }
  try {
    Module._extensions['.tsx'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, path)
    Module._load = function(name, ...args) {
      if (name === 'react') return hooks
      return originalLoad.call(this, name, ...args)
    }
    global.window = { location: {
      replace: path => navigations.push(['replace', path]),
      reload: () => navigations.push(['reload']),
    }, localStorage: new Proxy({}, { get() { throw new Error('No profile state in storage') } }) }
    global.fetch = async (...args) => { requests.push(args); return responder(...args) }
    delete require.cache[file]
    const { ProfileSelectionForm } = require(file)
    const render = () => { stateIndex = 0; refIndex = 0; effectIndex = 0; return ProfileSelectionForm({ initial, continuityToken: pageToken }) }
    const flushEffects = () => { while (effects.length) effects.shift()() }
    const select = id => nodes(render()).find(node => node.type === 'select' && node.props.id === id)
    const submit = () => render().props.onSubmit({ preventDefault() {} })
    const choose = (id, value) => select(id).props.onChange({ target: { value } })
    const saved = (departmentId = ids.department, academicLevelId = ids.level, academicPeriodId = ids.period) => ({
      status: 'complete', selection: {
        department: { id: departmentId, label: 'Persisted unit', isActive: true },
        academicLevel: { id: academicLevelId, label: 'Persisted stage', isActive: true },
        academicPeriod: { id: academicPeriodId, label: 'Persisted term', isActive: true },
      },
    })
    render()
    flushEffects()
    await run({ ids, options, initial, render, select, submit, choose, flushEffects, requests, navigations, saved,
      changeIncomingToken: value => { pageToken = value },
      remount: () => { state.length = 0; refs.length = 0; effectDeps.length = 0; effects.length = 0; render(); flushEffects() },
      respond: fn => { responder = fn }, notice: () => nodes(render()).find(node => node.type?.name === 'Feedback')?.props.message })
  } finally {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    if (oldFetch === undefined) delete global.fetch; else global.fetch = oldFetch
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow
    delete require.cache[file]
  }
}

test('server-returned choices keep database order and enable Department → Level → Semester', async () => fixture(async f => {
  const department = f.select('department')
  assert.deepEqual(nodes(department).filter(node => node.type === 'option').map(node => node.props.children),
    ['Choose department', 'Zeta unit', 'Alpha unit'])
  assert.equal(f.select('academic-level').props.disabled, true)
  assert.equal(f.select('academic-period').props.disabled, true)
  assert.deepEqual(nodes(f.render()).filter(node => node.type === 'select').map(node => node.props.id),
    ['department', 'academic-level', 'academic-period'])
  await f.submit()
  assert.equal(f.requests.length, 0)
  assert.equal(f.notice(), 'Choose a department.')
  f.choose('department', f.ids.department)
  assert.equal(f.notice(), undefined)
  assert.equal(f.select('academic-level').props.disabled, false)
  f.choose('academic-level', f.ids.level)
  assert.equal(f.select('academic-period').props.disabled, false)
  f.choose('academic-period', f.ids.period)
  f.respond(async () => response(200, f.saved()))
  await f.submit()
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0][0], '/api/profile-selection')
  assert.equal(f.requests[0][1].method, 'PUT')
  assert.equal(f.requests[0][1].headers['x-campus-account-continuity'], 'page:fixture-student')
  assert.deepEqual(JSON.parse(f.requests[0][1].body), {
    departmentId: f.ids.department, academicLevelId: f.ids.level, academicPeriodId: f.ids.period,
  })
  assert.deepEqual(f.navigations, [['replace', '/account']])
}))

test('validation focuses and describes the first missing choice, then clears when corrected', async () => fixture(async f => {
  const focused = []
  for (const id of ['department', 'academic-level', 'academic-period']) {
    f.select(id).props.ref.current = { focus: () => focused.push(id) }
  }
  const checkMissing = async (id, errorId, message) => {
    await f.submit()
    const tree = f.render()
    f.flushEffects()
    const control = nodes(tree).find(node => node.type === 'select' && node.props.id === id)
    const error = nodes(tree).find(node => node.props?.id === errorId)
    assert.equal(focused.at(-1), id)
    assert.equal(control.props['aria-invalid'], true)
    assert.equal(control.props['aria-describedby'], errorId)
    assert.equal(nodes(error).find(node => node.type?.name === 'Feedback').props.message, message)
    assert.equal(f.requests.length, 0)
  }
  await checkMissing('department', 'department-error', 'Choose a department.')
  focused.length = 0
  await f.submit()
  assert.deepEqual(focused, ['department'], 'repeating the same invalid submit focuses again')
  f.choose('department', f.ids.department)
  assert.equal(f.select('department').props['aria-invalid'], false)
  assert.equal(f.select('department').props['aria-describedby'], undefined)
  assert.equal(f.notice(), undefined)
  await checkMissing('academic-level', 'academic-level-error', 'Choose a level.')
  f.choose('academic-level', f.ids.level)
  assert.equal(f.select('academic-level').props['aria-invalid'], false)
  assert.equal(f.select('academic-level').props['aria-describedby'], undefined)
  await checkMissing('academic-period', 'academic-period-error', 'Choose a semester.')
  f.choose('academic-period', f.ids.period)
  assert.equal(f.select('academic-period').props['aria-invalid'], false)
  assert.equal(f.select('academic-period').props['aria-describedby'], undefined)
  assert.equal(f.notice(), undefined)
}))

test('complete selection restores; inactive history is shown but cannot be resubmitted as a choice', async () => fixture(async f => {
  assert.equal(f.select('department').props.value, f.ids.department)
  assert.equal(f.select('academic-level').props.value, f.ids.level)
  assert.equal(f.select('academic-period').props.value, f.ids.period)
  f.initial.selection.department = { id: f.ids.inactive, label: 'Former unit', isActive: false }
  f.remount()
  const historical = f.render()
  const summary = nodes(historical).find(node => node.type?.name === 'SelectionSummary')
  assert.equal(summary.props.selection.department.label, 'Former unit')
  assert.match(JSON.stringify(summary.type(summary.props)), /no longer available/)
  assert.equal(f.select('department').props.value, '')
  assert.equal(nodes(f.select('department')).filter(node => node.type === 'option').some(node => node.props.value === f.ids.inactive), false)
  await f.submit()
  assert.equal(f.requests.length, 0)
}, true))

test('changing an earlier choice clears later draft values before another save', async () => fixture(async f => {
  f.choose('department', f.ids.department)
  f.choose('academic-level', f.ids.level)
  f.choose('academic-period', f.ids.period)
  f.choose('department', f.ids.secondDepartment)
  assert.equal(f.select('academic-level').props.value, '')
  assert.equal(f.select('academic-period').props.value, '')
  await f.submit()
  assert.equal(f.requests.length, 0)
}))

test('a catalogue with no selectable row has a controlled non-submittable state', async () => fixture(async f => {
  f.options.academicPeriods.length = 0
  f.remount()
  const tree = f.render()
  assert.equal(nodes(tree).some(node => node.type === 'form'), false)
  assert.equal(nodes(tree).find(node => node.type?.name === 'Feedback').props.message,
    'Selection is unavailable. Please try again later.')
}))

test('completed student can change one value and return only after the persisted response confirms it', async () => fixture(async f => {
  f.choose('academic-period', f.ids.secondPeriod)
  f.respond(async () => response(200, f.saved(f.ids.department, f.ids.level, f.ids.secondPeriod)))
  await f.submit()
  assert.equal(JSON.parse(f.requests[0][1].body).academicPeriodId, f.ids.secondPeriod)
  assert.deepEqual(f.navigations, [['replace', '/account']])
}, true))

test('mismatched or malformed success cannot claim a saved profile', async () => fixture(async f => {
  f.respond(async () => response(200, f.saved(f.ids.secondDepartment)))
  await f.submit()
  assert.deepEqual(f.navigations, [])
  assert.equal(f.notice(), 'Save could not be confirmed. Reload the page.')
  f.respond(async () => response(200, { status: 'complete', selection: { private: 'provider detail' } }))
  await f.submit()
  assert.deepEqual(f.navigations, [])
  assert.equal(f.requests.length, 2)
}, true))

test('failed, unavailable, invalid and revoked saves have controlled outcomes', async () => fixture(async f => {
  const cases = [
    [503, { status: 'unavailable', details: 'private SQL error' }, 'Save failed. Please try again.'],
    [400, { status: 'invalid-selection' }, 'A choice is no longer available. Reload and choose again.'],
    [409, { status: 'missing-profile' }, 'Your profile could not be found. Please contact support.'],
    [409, { status: 'invariant-failure' }, 'Your profile needs attention. Please contact support.'],
    [400, { status: 'invalid-request' }, 'Save failed. Please try again.'],
  ]
  for (const [status, body, message] of cases) {
    f.respond(async () => response(status, body))
    await f.submit()
    assert.equal(f.notice(), message)
    assert.doesNotMatch(f.notice(), /SQL|provider|private/)
    assert.equal(nodes(f.render()).find(node => node.type === 'button' && node.props.type === 'submit').props.disabled, false)
  }
  f.respond(async () => { throw new Error('private network detail') })
  await f.submit()
  assert.equal(f.notice(), 'Save failed. Please try again.')
  f.respond(async () => response(401, { status: 'signed-out' }))
  await f.submit()
  assert.deepEqual(f.navigations, [['replace', '/login?next=%2Fprofile-selection']])
}, true))

test('a changed live account discards the old draft instead of retrying its save', async () => fixture(async f => {
  f.changeIncomingToken('page:other-student')
  f.respond(async () => response(409, { status: 'session-changed' }))
  await f.submit()
  assert.equal(f.requests[0][1].headers['x-campus-account-continuity'], 'page:fixture-student')
  assert.deepEqual(f.navigations, [['reload']])
  await f.submit()
  assert.equal(f.requests.length, 1)
}, true))

test('a double submit makes one request and keeps the form locked through navigation', async () => fixture(async f => {
  let resolve
  f.respond(() => new Promise(done => { resolve = done }))
  const first = f.submit()
  const second = f.submit()
  assert.equal(f.requests.length, 1)
  assert.equal(nodes(f.render()).find(node => node.type === 'button' && node.props.type === 'submit').props.disabled, true)
  resolve(response(200, f.saved()))
  await Promise.all([first, second])
  await f.submit()
  assert.equal(f.requests.length, 1)
  assert.deepEqual(f.navigations, [['replace', '/account']])
}, true))

test('presentation code contains no production catalogue values or persistent profile cache', () => {
  const paths = ['./ProfileSelectionForm.tsx', './page.tsx', '../../app/account/page.tsx',
    '../../components/profile/SelectionSummary.tsx', '../../lib/profile/paths.ts']
  const source = paths.map(path => fs.readFileSync(require.resolve(path), 'utf8')).join('\n')
  const migration = fs.readFileSync(require.resolve('../../supabase/migrations/20260918190000_profile_reference_data.sql'), 'utf8')
  const seededLabels = [...migration.matchAll(/'([^']+)',\s*true,\s*\d+\)/g)].map(match => match[1])
  const seededIds = [...migration.matchAll(/'([0-9a-f]{8}-[0-9a-f-]{27})'/g)].map(match => match[1])
  assert.ok(seededLabels.length > 0 && seededIds.length > 0)
  for (const label of seededLabels) {
    assert.equal(source.includes(`'${label}'`) || source.includes(`"${label}"`), false)
  }
  for (const id of seededIds) assert.equal(source.includes(id), false)
  assert.doesNotMatch(source, /localStorage|sessionStorage|createBrowserClient|service_role/)
})
