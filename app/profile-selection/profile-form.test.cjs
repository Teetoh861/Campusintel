const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { elementNodes } = require('../../lib/test/element-walker.cjs')


test('first name is labelled, validated, focusable and included in the secure save', async () => fixture(async f => {
  assert.equal(f.input().props.name, 'first_name')
  assert.equal(f.input().props.autoComplete, 'given-name')
  const focused = []
  f.input().props.ref.current = { focus: () => focused.push('first-name') }
  f.setName('  ')
  await f.submit(); f.render(); f.flushEffects()
  assert.equal(f.requests.length, 0)
  assert.equal(focused.at(-1), 'first-name')
  assert.equal(f.input().props['aria-invalid'], true)
  f.setName("  Ọlá Anne-Marie  ")
  f.choose('department', f.ids.department); f.choose('academic-level', f.ids.level); f.choose('academic-period', f.ids.period)
  f.respond(async () => response(200, { ...f.saved(), firstName: 'Ọlá Anne-Marie' }))
  await f.submit()
  assert.equal(JSON.parse(f.requests[0][1].body).first_name, '  Ọlá Anne-Marie  ')
  assert.deepEqual(f.navigations, [['replace', '/dashboard']])
}))

test('one-time name completion pre-fills persisted academic choices and never invents a name', async () => fixture(async f => {
  f.initial.status = 'incomplete'; f.initial.firstName = null; f.remount()
  assert.equal(f.input().props.value, '')
  assert.equal(f.select('department').props.value, f.ids.department)
  assert.equal(f.select('academic-level').props.value, f.ids.level)
  assert.equal(f.select('academic-period').props.value, f.ids.period)
}, true))

const nodes = element => elementNodes(element)

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
  const initial = complete ? { status: 'complete', revision: 0, options, selection, firstName: 'Adaeze' } : { status: 'incomplete', revision: 0, options, firstName: 'Adaeze' }
  const state = [], refs = [], effectDeps = [], effects = [], requests = [], navigations = []
  let stateIndex = 0, refIndex = 0, effectIndex = 0
  let pageToken = 'page:fixture-student'
  let mode = 'open'
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
    const render = () => { stateIndex = 0; refIndex = 0; effectIndex = 0; return ProfileSelectionForm({ initial, continuityToken: pageToken, mode }) }
    const flushEffects = () => { while (effects.length) effects.shift()() }
    const input = () => nodes(render()).find(node => node.type === 'input' && node.props.id === 'first-name')
    const setName = value => input().props.onChange({ target: { value } })
    const select = id => nodes(render()).find(node => node.type === 'select' && node.props.id === id)
    const submit = () => render().props.onSubmit({ preventDefault() {} })
    const choose = (id, value) => select(id).props.onChange({ target: { value } })
    const saved = (departmentId = ids.department, academicLevelId = ids.level, academicPeriodId = ids.period) => ({
      status: 'complete', revision: 1, firstName: 'Adaeze', selection: {
        department: { id: departmentId, label: 'Persisted unit', isActive: true },
        academicLevel: { id: academicLevelId, label: 'Persisted stage', isActive: true },
        academicPeriod: { id: academicPeriodId, label: 'Persisted term', isActive: true },
      },
    })
    render()
    flushEffects()
    await run({ ids, options, initial, render, input, setName, select, submit, choose, flushEffects, requests, navigations, saved,
      changeIncomingToken: value => { pageToken = value },
      setMode: value => { mode = value },
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
    departmentId: f.ids.department, academicLevelId: f.ids.level, academicPeriodId: f.ids.period, first_name: 'Adaeze', expectedRevision: 0,
  })
  assert.deepEqual(f.navigations, [['replace', '/dashboard']])
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
    'We couldn’t load your academic details. Please try again later.')
}))

test('completed student can change one value and return only after the persisted response confirms it', async () => fixture(async f => {
  f.choose('academic-period', f.ids.secondPeriod)
  f.respond(async () => response(200, f.saved(f.ids.department, f.ids.level, f.ids.secondPeriod)))
  await f.submit()
  assert.equal(JSON.parse(f.requests[0][1].body).academicPeriodId, f.ids.secondPeriod)
  assert.deepEqual(f.navigations, [['replace', '/dashboard']])
}, true))

test('mismatched or malformed success cannot claim a saved profile', async () => fixture(async f => {
  f.respond(async () => response(200, f.saved(f.ids.secondDepartment)))
  await f.submit()
  assert.deepEqual(f.navigations, [])
  assert.equal(f.notice(), 'We couldn’t confirm your changes were saved. Reload the page to check.')
  f.respond(async () => response(200, { status: 'complete', revision: 1, firstName: 'Adaeze', selection: { private: 'provider detail' } }))
  await f.submit()
  assert.deepEqual(f.navigations, [])
  assert.equal(f.requests.length, 2)
}, true))

test('profile edit and reload actions keep shared button hierarchy and focus', async () => fixture(async f => {
  const check = (node, outlined) => {
    const actual = new Set(node.props.className.split(/\s+/))
    const required = ['min-h-11', 'px-4', 'py-2', 'text-[14px]', 'tablet:text-[15px]',
      'focus-visible:outline', 'focus-visible:outline-2', 'focus-visible:outline-student-focus',
      ...(outlined ? ['border-student-border-strong', 'bg-transparent'] : ['bg-student-primary'])]
    for (const token of required) assert.ok(actual.has(token), `missing action style ${token}`)
    for (const token of ['px-5', 'py-2.5', 'text-[15px]', ...(outlined ? ['border-transparent'] : [])]) {
      assert.equal(actual.has(token), false, `conflicting action style ${token}`)
    }
    assert.equal(actual.has('underline'), false)
  }
  check(nodes(f.render()).find(node => node.props?.children === 'Back to account'), true)
  check(nodes(f.render()).find(node => node.type === 'button' && node.props.type === 'submit'), false)
  f.respond(async () => response(400, { status: 'invalid-selection' }))
  await f.submit()
  check(nodes(f.render()).find(node => node.props?.children === 'Reload choices'), true)
}, true))

test('selection form stays compact and uses the student surface at phone and tablet widths', async () => fixture(async f => {
  const form = f.render()
  assert.equal(form.type, 'form')
  assert.match(form.props.className, /student-surface student-surface-raised/)
  const fields = nodes(form).find(node => node.props?.className?.includes('tablet:grid-cols-2'))
  assert.ok(fields)
  assert.match(nodes(fields).find(node => node.props?.className?.includes('tablet:col-span-2'))?.props.className,
    /tablet:col-span-2/)
  for (const id of ['department', 'academic-level', 'academic-period']) {
    assert.match(f.select(id).props.className, /h-12/)
  }
  assert.match(nodes(form).find(node => node.type === 'button' && node.props.type === 'submit').props.className,
    /min-h-11/)
}))

test('failed, unavailable, invalid and revoked saves have controlled outcomes', async () => fixture(async f => {
  const cases = [
    [503, { status: 'unavailable', details: 'private SQL error' }, 'We couldn’t save your changes. Please try again.'],
    [400, { status: 'invalid-selection' }, 'Review your first name and choices, or reload if a choice is no longer available.'],
    [409, { status: 'missing-profile' }, 'Your profile could not be found. Please contact support.'],
    [409, { status: 'invariant-failure' }, 'Your profile needs attention. Please contact support.'],
    [400, { status: 'invalid-request' }, 'We couldn’t save your changes. Please try again.'],
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
  assert.equal(f.notice(), 'We couldn’t save your changes. Please try again.')
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
  assert.deepEqual(f.navigations, [['replace', '/dashboard']])
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

test('mounted draft freezes expectedRevision despite later incoming profile props', async () => fixture(async f => {
  f.initial.revision = 7
  f.initial.firstName = 'New incoming name'
  f.render()
  await f.submit()
  assert.equal(JSON.parse(f.requests[0][1].body).expectedRevision, 0)
  assert.equal(JSON.parse(f.requests[0][1].body).first_name, 'Adaeze')
}, true))

test('success requires a safe newer revision as well as matching saved fields', async () => fixture(async f => {
  for (const revision of [undefined, -1, 0, '1', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    f.respond(async () => response(200, { ...f.saved(), revision }))
    await f.submit()
    assert.deepEqual(f.navigations, [])
    assert.equal(f.notice(), 'We couldn’t confirm your changes were saved. Reload the page to check.')
  }
  f.respond(async () => response(200, f.saved()))
  await f.submit()
  assert.deepEqual(f.navigations, [['replace', '/dashboard']])
}, true))

test('conflict blocks stale saves through field edits until explicit reload', async () => fixture(async f => {
  f.respond(async () => response(409, { status: 'conflict' }))
  await f.submit()
  assert.deepEqual(f.navigations, [])
  assert.equal(f.notice(), 'Your courses were just updated. Check them and try again.')
  const save = () => nodes(f.render()).find(node => node.type === 'button' && node.props.type === 'submit')
  assert.equal(save().props.disabled, true)
  assert.equal(save().props['aria-busy'], false)
  f.setName('Amara')
  f.choose('academic-period', f.ids.secondPeriod)
  await f.submit()
  assert.equal(f.requests.length, 1)
  assert.equal(save().props.disabled, true)
  const reload = nodes(f.render()).find(node => node.props?.children === 'Reload latest profile')
  assert.ok(reload)
  let focused = 0
  reload.props.ref.current = { focus: () => { focused++ } }
  f.flushEffects()
  assert.equal(focused, 1, 'conflict moves focus to its explicit recovery action')
  reload.props.onClick()
  assert.deepEqual(f.navigations, [['reload']])
  // A deliberate remount loads the new durable revision and permits a new save.
  f.initial.revision = 1
  f.remount()
  f.respond(async () => response(200, { ...f.saved(), revision: 2 }))
  await f.submit()
  assert.equal(JSON.parse(f.requests[1][1].body).expectedRevision, 1)
  assert.deepEqual(f.navigations, [['reload'], ['replace', '/dashboard']])
}, true))

test('lost response has no automatic retry and manual retry retains the draft revision', async () => fixture(async f => {
  f.respond(async () => { throw new Error('response lost') })
  await f.submit()
  assert.equal(f.requests.length, 1)
  f.respond(async () => response(409, { status: 'conflict' }))
  await f.submit()
  assert.equal(f.requests.length, 2)
  assert.deepEqual(f.requests.map(request => JSON.parse(request[1].body).expectedRevision), [0, 0])
  assert.deepEqual(f.navigations, [])
}, true))

const coursesSet = tree => nodes(tree).some(node => node.type?.name === 'CoursesSetNotice')
const firstPick = tree => nodes(tree).find(node => node.props?.['data-first-pick'] === '')
const selects = tree => nodes(tree).filter(node => node.type === 'select')

test('locked: the courses are shown, not offered; the name still saves with the same courses', async () => fixture(async f => {
  f.setMode('locked'); f.remount()
  const tree = f.render()
  assert.equal(coursesSet(tree), true, 'the locked message and its Message us link are shown')
  assert.deepEqual(selects(tree), [], 'no department, level or semester can be chosen')
  assert.equal(firstPick(tree), undefined)
  assert.equal(nodes(tree).find(node => node.type === 'button' && node.props.type === 'submit')?.props.children, 'Save name')
  f.setName('Amara')
  f.respond(async () => response(200, { ...f.saved(), firstName: 'Amara' }))
  await f.submit()
  assert.deepEqual(JSON.parse(f.requests[0][1].body), { departmentId: f.ids.department, academicLevelId: f.ids.level,
    academicPeriodId: f.ids.period, first_name: 'Amara', expectedRevision: 0 })
  assert.deepEqual(f.navigations, [['replace', '/dashboard']])
}, true))

test('locked with an inactive saved course still sends the saved courses, never a blank choice', async () => fixture(async f => {
  f.initial.selection.department = { id: f.ids.inactive, label: 'Former unit', isActive: false }
  f.setMode('locked'); f.remount()
  await f.submit()
  assert.equal(JSON.parse(f.requests[0][1].body).departmentId, f.ids.inactive)
}, true))

test('first pick while a plan is running: warned before saving, then the same save', async () => fixture(async f => {
  f.setMode('first-pick'); f.remount()
  assert.equal(firstPick(f.render()).props.children, 'Your courses will be set for this semester once you save.')
  assert.equal(coursesSet(f.render()), false)
  assert.equal(selects(f.render()).length, 3)
  f.choose('department', f.ids.department); f.choose('academic-level', f.ids.level); f.choose('academic-period', f.ids.period)
  f.respond(async () => response(200, f.saved()))
  await f.submit()
  assert.deepEqual(f.navigations, [['replace', '/dashboard']])
}))

test('an open form shows neither the warning nor the locked message', async () => fixture(async f => {
  assert.equal(firstPick(f.render()), undefined)
  assert.equal(coursesSet(f.render()), false)
}, true))

test('the database refusal (CI423, sent as locked) shows the locked view, never a raw error', async () => fixture(async f => {
  f.choose('department', f.ids.secondDepartment); f.choose('academic-level', f.ids.level); f.choose('academic-period', f.ids.period)
  f.respond(async () => response(409, { status: 'locked' }))
  await f.submit()
  const tree = f.render()
  assert.equal(coursesSet(tree), true)
  assert.equal(f.notice(), undefined, 'no error message, only the locked message')
  assert.equal(nodes(tree).find(node => node.type === 'button' && node.props.type === 'submit')?.props.children, 'Save name')
  assert.deepEqual(selects(tree), [])
  assert.deepEqual(f.navigations, [])
  // The name can still be saved; the saved courses go back unchanged.
  f.respond(async () => response(200, f.saved()))
  await f.submit()
  assert.equal(JSON.parse(f.requests[1][1].body).departmentId, f.ids.department)
}, true))


test('a non-running semester refusal names only the choice to fix and focuses it',async()=>fixture(async f=>{
  f.choose('department',f.ids.department); f.choose('academic-level',f.ids.level); f.choose('academic-period',f.ids.secondPeriod)
  const focused=[]
  f.select('academic-period').props.ref.current={focus:()=>focused.push('semester')}
  f.respond(async()=>response(409,{status:'semester-not-running'}))
  await f.submit(); f.render(); f.flushEffects()
  assert.equal(f.notice(),"That semester isn't running now. Choose the current semester.")
  assert.equal(f.select('academic-period').props['aria-invalid'],true)
  assert.equal(f.select('academic-period').props['aria-describedby'],'academic-period-error')
  assert.equal(focused.at(-1),'semester')
  assert.deepEqual(f.navigations,[])
  f.choose('academic-period',f.ids.period)
  assert.equal(f.notice(),undefined)
  f.respond(async()=>response(200,f.saved()))
  await f.submit()
  assert.deepEqual(f.navigations,[['replace','/dashboard']])
}))
