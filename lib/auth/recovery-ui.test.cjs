// lib/auth/recovery-ui.test.cjs — Recovery component transitions with in-memory hooks and mocked HTTP.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
require('react/jsx-runtime')
const React = require('react')
const hookForm = require('react-hook-form')
const { AUTH_API, AUTH_MESSAGES, RECOVERY_FAILURE, PASSWORD_RESET_DESTINATION } = require('./constants.ts')
const { elementNodes } = require('../../lib/test/element-walker.cjs')


const nodes = element => elementNodes(element, { expand: ['AuthFormLayout', 'AuthSecondaryActions'] })

function styleTokens(value) { return new Set((value || '').split(/\s+/).filter(Boolean)) }

function assertUsesStyle(node, ...primitives) {
  const actual = styleTokens(node.props.className)
  for (const token of primitives.flatMap(primitive => [...styleTokens(primitive)])) {
    assert.ok(actual.has(token), `${String(node.props.children)} is missing shared style ${token}`)
  }
}

function assertNoDefaultUnderline(node) {
  const actual = styleTokens(node.props.className)
  assert.equal(actual.has('underline') || actual.has('decoration-underline'), false)
}

// Exercise the actual components, retaining hooks separately for each mounted component.
async function fixture(run) {
  const original = Module._load
  const savedCache = new Map(Object.entries(require.cache))
  const originalTsx = Module._extensions['.tsx']
  const oldWindow = global.window
  const states = new Map()
  let active, index, values = {}, nextFailure, submissionError = ''
  const requests = [], destinations = [], navigations = [], historyChanges = [], resets = [], effects = [], focuses = []
  let nextResult = {}, pending = false
  const submit = async (endpoint, body, onFailure) => {
    submissionError = ''
    requests.push({ endpoint, body })
    if (nextFailure) { const failure = nextFailure; nextFailure = undefined; submissionError = failure.message; onFailure?.(failure); return null }
    return nextResult
  }
  const hooks = {
    ...React,
    useState(initial) {
      const state = active, slot = index++
      if (!(slot in state)) state[slot] = initial
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value }]
    },
    useRef: initial => ({ current: initial ?? null }), useEffect: effect => { effects.push(effect) },
    forwardRef: fn => fn,
  }
  const files = ['../../app/forgot-password/RecoveryFlow.tsx', '../../app/reset-password/ResetPasswordForm.tsx', '../../app/reset-password/page.tsx', '../../app/register/RegisterForm.tsx', '../../app/login/LoginForm.tsx', '../../app/confirm-email/ConfirmEmailForm.tsx', '../../app/confirm-email/page.tsx', '../../app/login/page.tsx', '../../components/chrome/FormField.tsx', '../../components/chrome/Feedback.tsx', '../../components/auth/LogoutButton.tsx', '../../components/auth/AuthNavActions.tsx', '../../components/chrome/Nav.tsx', '../../components/auth/AuthShell.tsx', '../../components/auth/EmailForm.tsx']
  const paths = files.map(file => require.resolve(file))
  try {
    const forbiddenStorage = new Proxy({}, { get() { throw new Error('Recovery must not use persistent browser storage') } })
    global.window = {
      location: {
        assign: destination => { destinations.push(destination); navigations.push(['assign', destination]) },
        replace: destination => { destinations.push(destination); navigations.push(['replace', destination]) },
      },
      history: {
        pushState: (...args) => historyChanges.push(['pushState', ...args]),
        replaceState: (...args) => historyChanges.push(['replaceState', ...args]),
      },
      localStorage: forbiddenStorage,
      sessionStorage: forbiddenStorage,
    }
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'react') return hooks
      if (name === 'next/navigation') return { ...original.call(this, name, ...args), usePathname: () => '/courses' }
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => true }
      if (name === './NavigationSession' || name === '@/components/auth/NavigationSession') {
        return { useNavigationSession: () => ({ signedIn: false, version: 0, continuityToken: 'fixture-rendered-session' }) }
      }
      if (name === '@/components/auth/useAuthSubmit' || name === './useAuthSubmit') return { useAuthSubmit: () => ({ submit, pending, error: submissionError,
        clearError: () => { submissionError = '' } }) }
      if (name === 'react-hook-form') return { ...hookForm, useForm: options => ({
        // A field's own onChange option is handed through, as the real register does.
        register: (name, field) => ({ name, ...(field?.onChange ? { onChange: field.onChange } : {}) }), formState: { errors: {} }, reset: () => { resets.push('all'); values = {} }, resetField: name => { resets.push(name); delete values[name] },
        setFocus: name => { focuses.push(name) },
        handleSubmit: fn => async () => {
          const parsed = await options.resolver(values, {}, {})
          if (!Object.keys(parsed.errors).length) return fn(parsed.values)
        },
      }) }
      return original.call(this, name, ...args)
    }
    for (const path of paths) delete require.cache[path]
    const { RecoveryFlow } = require(paths[0])
    const render = (component, props = {}) => {
      if (!states.has(component)) states.set(component, [])
      active = states.get(component); index = 0
      return component(props)
    }
    const flow = () => render(RecoveryFlow)
    const child = (tree, name) => nodes(tree).find(node => node.type?.name === name)
    await run({ flow, render, child, requests, destinations, navigations, historyChanges, resets, effects, focuses, setState: (component, slot, value) => { states.get(component)[slot] = value }, setPending: value => { pending = value }, component: i => require(paths[i]), result: value => { nextResult = value }, setValues: v => { values = v }, fail: f => { nextFailure = f }, direct: () => { const gate = require(paths[2]).default(); return gate.props.children.type(gate.props.children.props) } })
  } finally {
    Module._load = original
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow
    for (const path of paths) delete require.cache[path]
    for (const key of Object.keys(require.cache)) if (!savedCache.has(key)) delete require.cache[key]
    for (const [key, value] of savedCache) require.cache[key] = value
  }
}

test('email request precedes code-only verification; only a verified response reveals password fields', async () => fixture(async f => {
  const entry = f.child(f.flow(), 'EmailForm')
  assert.equal(entry.props.recovery, true)
  entry.props.onRecoveryRequested('student@example.test')
  assert.equal(f.flow().props.title, 'Check your email')
  const code = f.child(f.flow(), 'RecoveryCodeForm')
  const form = f.render(code.type, code.props)
  assert.deepEqual(nodes(form).filter(n => n.props?.id).map(n => n.props.id), ['code'])
  assert.ok(JSON.stringify(form).includes('student@example.test'))
  assert.ok(nodes(form).some(n => n.type === 'button' && n.props.children === 'Continue'))
  for (const code of ['', 'not-numeric']) { f.setValues({ code }); await form.props.onSubmit() }
  assert.equal(f.requests.length, 0)
  f.setValues({ code: '123456' }); await form.props.onSubmit()
  assert.equal(f.child(f.flow(), 'ResetPasswordForm'), undefined) // A bare HTTP success cannot claim verification.
  f.result({ verified: true }); f.setValues({ code: '123456' }); await form.props.onSubmit()
  assert.equal(f.flow().props.title, 'Change password')
  assert.ok(f.resets.includes('code'))
  assert.deepEqual(f.requests[0], { endpoint: AUTH_API.verifyRecovery, body: { email: 'student@example.test', code: '123456' } })
  const reset = f.child(f.flow(), 'ResetPasswordForm')
  const passwords = f.render(reset.type, reset.props)
  assert.deepEqual(nodes(passwords).filter(n => n.props?.id).map(n => n.props.id), ['password', 'confirmation'])
  assert.ok(!JSON.stringify(passwords).includes('student@example.test'))
  assert.equal(f.child(passwords, 'AuthFormLayout').props.secondaryActions, undefined)
  assert.doesNotMatch(JSON.stringify(passwords), /Start over/)
  assert.deepEqual(f.historyChanges, [])
  f.setValues({ password: 'Test-password-only', confirmation: 'Different-password' }); await passwords.props.onSubmit()
  assert.equal(f.requests.length, 2)
  f.result({}); f.setValues({ password: 'Test-password-only', confirmation: 'Test-password-only' }); await passwords.props.onSubmit()
  assert.deepEqual(f.requests[2], { endpoint: AUTH_API.reset, body: { email: 'student@example.test', password: 'Test-password-only' } })
  // The reset screen confirms the change itself: nothing navigates, and Sign in is the only thing left to do.
  assert.deepEqual(f.destinations, [])
  const done = f.flow()
  assert.equal(done.props.title, 'Password changed')
  assert.equal(f.child(done, 'ResetPasswordForm'), undefined)
  assert.deepEqual(nodes(done).filter(node => node.props?.href).map(node => [node.props.href, node.props.children]),
    [[PASSWORD_RESET_DESTINATION, 'Sign in']])
  assert.equal(nodes(done).find(node => node.props?.role === 'status').props.children, 'Password changed.')
  assert.deepEqual(f.historyChanges, [], 'and nothing about it goes into the address')
}))

test('a refused new password keeps the student on Change password, with the reason under the field', async () => fixture(async f => {
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  f.child(f.flow(), 'RecoveryCodeForm').props.onVerified()
  const reset = f.child(f.flow(), 'ResetPasswordForm')
  const field = (form, id) => nodes(form).find(node => node.props?.id === id)
  let form = f.render(reset.type, reset.props)
  assert.deepEqual([AUTH_MESSAGES.weakPassword, AUTH_MESSAGES.samePassword], ['Choose a stronger password.', 'Choose a different password.'])
  for (const line of [AUTH_MESSAGES.weakPassword, AUTH_MESSAGES.samePassword]) {
    f.fail({ code: RECOVERY_FAILURE.password, message: line })
    f.setValues({ password: 'Test-password-only', confirmation: 'Test-password-only' }); await form.props.onSubmit()
    assert.equal(f.flow().props.title, 'Change password', 'the flow stays on this step')
    assert.ok(f.child(f.flow(), 'ResetPasswordForm'))
    form = f.render(reset.type, reset.props)
    assert.equal(field(form, 'password').props.error, line)
    assert.equal(field(form, 'confirmation').props.error, undefined)
    assert.equal(f.child(form, 'Feedback').props.message, '', 'said once, under the field')
    // Read out where it happened: focus goes back to New password, which the reason describes.
    const focused = f.focuses.length
    f.effects.at(-1)()
    assert.deepEqual(f.focuses.slice(focused), ['password'])
  }
  // Typing another password clears the reason, and so does any new attempt, valid or not.
  field(form, 'password').props.onChange()
  form = f.render(reset.type, reset.props)
  assert.equal(field(form, 'password').props.error, undefined)
  assert.equal(f.child(form, 'Feedback').props.message, '')
  const typed = f.focuses.length
  f.effects.at(-1)()
  assert.equal(f.focuses.length, typed, 'with nothing refused, focus stays where the student put it')
  f.fail({ code: RECOVERY_FAILURE.password, message: AUTH_MESSAGES.weakPassword })
  f.setValues({ password: 'Test-password-only', confirmation: 'Test-password-only' }); await form.props.onSubmit()
  assert.equal(field(f.render(reset.type, reset.props), 'password').props.error, AUTH_MESSAGES.weakPassword)
  f.setValues({ password: 'Test-password-only', confirmation: 'Different-password' }); await form.props.onSubmit()
  form = f.render(reset.type, reset.props)
  assert.equal(field(form, 'password').props.error, undefined, 'an attempt that never reaches the server still clears it')
  assert.equal(f.child(form, 'Feedback').props.message, '')
  assert.equal(f.requests.length, 3, 'three requests: the invalid attempt sent none')
  assert.equal(f.destinations.length, 0)
}))

test('well-formed wrong code reaches verification server and cannot advance past the safe error', async () => fixture(async f => {
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  const code = f.child(f.flow(), 'RecoveryCodeForm')
  const form = f.render(code.type, code.props)
  f.fail({ message: AUTH_MESSAGES.recoveryCode })
  f.setValues({ code: '123456' }); await form.props.onSubmit()
  assert.deepEqual(f.requests, [{ endpoint: AUTH_API.verifyRecovery, body: { email: 'student@example.test', code: '123456' } }])
  assert.equal(f.flow().props.title, 'Check your email')
  assert.equal(f.child(f.flow(), 'ResetPasswordForm'), undefined)
  assert.equal(f.child(f.render(code.type, code.props), 'Feedback').props.message, 'Invalid or expired code.')
  assert.equal(f.destinations.length, 0)
}))

test('invalid recovery grant destroys the flow instead of allowing a password retry', async () => fixture(async f => {
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  f.child(f.flow(), 'RecoveryCodeForm').props.onVerified()
  const reset = f.child(f.flow(), 'ResetPasswordForm')
  const form = f.render(reset.type, reset.props)
  f.fail({ code: RECOVERY_FAILURE.restart, message: AUTH_MESSAGES.recoveryRestart })
  f.setValues({ password: 'Test-password-only', confirmation: 'Test-password-only' }); await form.props.onSubmit()
  assert.equal(f.flow().props.title, 'Forgot password')
  assert.equal(f.child(f.flow(), 'ResetPasswordForm'), undefined)
  assert.equal(f.destinations.length, 0)
  const request = f.child(f.flow(), 'EmailForm')
  assert.deepEqual(request.props.initialFeedback, { message: AUTH_MESSAGES.recoveryRestart, tone: 'error' })
  let entry = f.render(request.type, request.props)
  assert.equal(nodes(entry).filter(node => node.type?.name === 'Feedback').length, 1)
  assert.equal(f.child(entry, 'Feedback').props.message, AUTH_MESSAGES.recoveryRestart)

  f.fail({ message: AUTH_MESSAGES.unavailable })
  f.setValues({ email: 'student@example.test' })
  await entry.props.onSubmit()
  entry = f.render(request.type, request.props)
  assert.equal(nodes(entry).filter(node => node.type?.name === 'Feedback').length, 1)
  assert.equal(f.child(entry, 'Feedback').props.message, AUTH_MESSAGES.unavailable)
  assert.ok(!JSON.stringify(entry).includes(AUTH_MESSAGES.recoveryRestart))
}))

test('resend uses bound email; change-email cancels grant and clears flow; direct reset stays protected', async () => fixture(async f => {
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  const code = f.child(f.flow(), 'RecoveryCodeForm')
  const form = f.render(code.type, code.props)
  const buttons = nodes(form).filter(node => node.type === 'button')
  assert.deepEqual(buttons.map(node => node.props.children), ['Continue', 'Didn’t receive it? Resend code', 'Change email'])
  assert.doesNotMatch(JSON.stringify(form), /Wrong email\?|Start over/)
  await buttons.find(node => node.props.children === 'Didn’t receive it? Resend code').props.onClick()
  assert.deepEqual(f.requests, [{ endpoint: AUTH_API.forgot, body: { email: 'student@example.test' } }])
  let resent = f.render(code.type, code.props)
  assert.equal(f.child(resent, 'Feedback').props.message, 'We sent a new code to student@example.test.')
  f.result(null)
  await nodes(resent).find(node => node.type === 'button' && node.props.children === 'Change email').props.onClick()
  assert.deepEqual(f.requests[1], { endpoint: AUTH_API.cancelRecovery, body: { email: 'student@example.test' } })
  resent = f.render(code.type, code.props)
  assert.equal(f.child(resent, 'Feedback').props.message, '')
  assert.equal(f.flow().props.title, 'Check your email')
  f.result({ success: true })
  await nodes(resent).find(node => node.type === 'button' && node.props.children === 'Change email').props.onClick()
  assert.deepEqual(f.requests[2], { endpoint: AUTH_API.cancelRecovery, body: { email: 'student@example.test' } })
  assert.equal(f.flow().props.title, 'Forgot password')
  assert.equal(f.child(f.flow(), 'RecoveryCodeForm'), undefined)
  // A direct visit to Reset password has no email and no verified code: it goes to Forgot password, explaining nothing.
  assert.throws(() => f.direct(), error => /^NEXT_REDIRECT;[^;]*;\/forgot-password;/.test(error.digest))
}))

test('registration and unconfirmed login clear passwords and keep confirmation email bound until email change', async () => fixture(async f => {
  for (const [index, exportName] of [[3, 'RegisterForm'], [4, 'LoginForm']]) {
    const component = f.component(index)[exportName]
    let form = f.render(component, { next: '/courses' })
    f.result(index === 4 ? { code: 'EMAIL_CONFIRMATION_REQUIRED' } : {})
    f.setValues({ email: 'student@example.test', password: 'Test-password-only', ...(index === 3 ? { confirmation: 'Test-password-only' } : {}) })
    await form.props.onSubmit()
    assert.ok(f.resets.includes(index === 3 ? 'all' : 'password'))
    // An accepted request continues straight to code entry; no intermediate receipt screen exists.
    const confirmation = f.render(component, { next: '/courses' })
    assert.equal(confirmation.type.name, 'ConfirmEmailForm')
    assert.equal(confirmation.props.email, 'student@example.test')
    assert.equal(confirmation.props.password, undefined)
    form = f.render(confirmation.type, confirmation.props)
    assert.deepEqual(nodes(form).filter(n => n.type?.name === 'FormField').map(n => n.props.id), ['code'])
    confirmation.props.onStartOver()
    assert.equal(f.render(component, { next: '/courses' }).type, 'form')
  }
  // A direct visit to Confirm email has no email to confirm: it goes to Sign in, explaining nothing.
  const gate = f.component(6).default()
  assert.equal(gate.type.name, 'SignedOutGate')
  assert.throws(() => gate.props.children.type(gate.props.children.props), error => /^NEXT_REDIRECT;[^;]*;\/login;/.test(error.digest))
}))

test('registration and unconfirmed-login initiation failures stay in the shared form feedback slot', async () => fixture(async f => {
  for (const [index, exportName, message] of [[3, 'RegisterForm', AUTH_MESSAGES.limited], [4, 'LoginForm', AUTH_MESSAGES.unavailable]]) {
    const component = f.component(index)[exportName]
    let form = f.render(component, { next: '/courses' })
    f.fail({ message })
    f.setValues({ email: 'student@example.test', password: 'Test-password-only',
      ...(index === 3 ? { confirmation: 'Test-password-only' } : {}) })
    await form.props.onSubmit()
    form = f.render(component, { next: '/courses' })
    assert.equal(form.type, 'form')
    assert.equal(f.child(form, 'Feedback').props.message, message)
    assert.deepEqual(f.resets, [])
  }
  assert.equal(f.destinations.length, 0)
}))

test('successful login retains fields and pending appearance until navigation; failed login retains credentials', async () => fixture(async f => {
  const { LoginForm } = f.component(4)
  const form = f.render(LoginForm, { next: '/courses' })
  f.setValues({ email: 'student@example.test', password: 'x' })
  f.fail({ message: 'Incorrect email or password.' })
  await form.props.onSubmit()
  assert.equal(f.requests.length, 1)
  assert.deepEqual(f.resets, [])
  assert.equal(f.child(f.render(LoginForm, { next: '/courses' }), 'Feedback').props.message, 'Incorrect email or password.')
  f.result({ next: '/courses' })
  await form.props.onSubmit()
  assert.deepEqual(f.resets, [])
  assert.deepEqual(f.destinations, ['/courses'])
  const pending = f.render(LoginForm, { next: '/courses' })
  const button = nodes(pending).find(n => n.type === 'button')
  assert.equal(button.props.children, 'Signing in…')
  assert.equal(button.props.disabled, true)
}))

test('sign in shows no notice after a reset; the deletion notice is a warning read in the browser, shown once; feedback has no error prefix', async () => fixture(async f => {
  const { ACCOUNT_MESSAGES } = require('../account/constants.ts')
  const signInPage = async state => {
    const gate = f.component(7).default({ searchParams: Promise.resolve(state === undefined ? {} : { state }) })
    const page = await gate.props.children.type(gate.props.children.props)
    assert.equal(page.props.title, 'Sign in')
    return f.child(page, 'LoginForm')
  }
  // The server renders no notice, whatever the address says: the router's cached copy of the page then has none to
  // bring back on Back. A reset is confirmed on its own screen, so Sign in carries nothing about it either.
  assert.equal(PASSWORD_RESET_DESTINATION, '/login')
  for (const state of [undefined, 'password-reset', 'deletion-scheduled', 'something-else']) {
    assert.deepEqual(Object.keys((await signInPage(state)).props), ['next'], String(state))
  }
  const login = await signInPage('deletion-scheduled')
  let form = f.render(login.type, login.props)
  assert.equal(f.child(form, 'Feedback').props.message, '', 'nothing before the page runs in the browser')
  // In the browser the form reads the notice and takes it out of the address on the next task, once Next's router
  // owns history (its effect runs after this one on a fresh load): a replace before then would wipe its record.
  global.window.location.href = 'https://campusintell.test/login?state=deletion-scheduled&next=%2Fcourses'
  let cleanup = f.effects.at(-1)()
  assert.deepEqual(f.historyChanges, [], 'not while the page is still loading')
  // React's development double mount cleans up first: the replace that was waiting is dropped, the next one runs.
  cleanup()
  cleanup = f.effects.at(-1)()
  await new Promise(resolve => setTimeout(resolve))
  assert.deepEqual(f.historyChanges, [['replaceState', null, '', '/login?next=%2Fcourses']], 'once, keeping the return path')
  form = f.render(login.type, login.props)
  assert.equal(nodes(form).filter(node => node.type?.name === 'Feedback').length, 1)
  assert.equal(f.child(form, 'Feedback').props.message, ACCOUNT_MESSAGES.scheduled)
  assert.equal(f.child(form, 'Feedback').props.tone, 'warning', 'never shown as a success')
  // Reload and Back load the address without it: nothing is shown and nothing is replaced.
  global.window.location.href = 'https://campusintell.test/login?next=%2Fcourses'
  const again = await signInPage(undefined)
  f.effects.length = 0
  f.render(again.type, { ...again.props })
  assert.equal(f.effects.at(-1)(), undefined)
  await new Promise(resolve => setTimeout(resolve))
  assert.equal(f.historyChanges.length, 1, 'an address without a notice is left alone')
  // An unknown state is taken out of the address too, without a notice.
  global.window.location.href = 'https://campusintell.test/login?state=something-else'
  f.effects.at(-1)()
  await new Promise(resolve => setTimeout(resolve))
  assert.deepEqual(f.historyChanges.at(-1), ['replaceState', null, '', '/login'])
  form = f.render(login.type, login.props)
  // It goes on the first submit attempt, even one that never reaches the server.
  f.setValues({ email: '', password: '' })
  await form.props.onSubmit()
  assert.equal(f.requests.length, 0)
  form = f.render(login.type, login.props)
  assert.equal(f.child(form, 'Feedback').props.message, '')
  f.fail({ message: AUTH_MESSAGES.credentials })
  f.setValues({ email: 'student@example.test', password: 'wrong-password' })
  await form.props.onSubmit()
  form = f.render(login.type, login.props)
  assert.equal(nodes(form).filter(node => node.type?.name === 'Feedback').length, 1)
  assert.equal(f.child(form, 'Feedback').props.message, AUTH_MESSAGES.credentials)
  assert.equal(f.child(form, 'Feedback').props.tone, 'error')
  assert.ok(!JSON.stringify(form).includes(ACCOUNT_MESSAGES.scheduled))
  // The failure goes the same way: the next attempt, valid or not, never shows it beside a field message.
  f.setValues({ email: '', password: '' })
  await form.props.onSubmit()
  assert.equal(f.child(f.render(login.type, login.props), 'Feedback').props.message, '')
  const field = f.component(8).FormField({ id: 'password', label: 'Password', error: 'Enter your password.' })
  const feedback = f.component(9).Feedback({ tone: 'error', message: 'Incorrect email or password.' })
  assert.doesNotMatch(JSON.stringify([field, feedback]), /error:/i)
  assert.equal(feedback.props.role, 'alert')
}))

test('login keeps a feedback home without empty field errors, with stable controls while pending', async () => fixture(async f => {
  const { LoginForm } = f.component(4)
  const initial = f.render(LoginForm, { next: '/courses' })
  assert.ok(f.child(initial, 'AuthFormLayout'))
  assert.equal(f.child(initial, 'Feedback').props.message, '')
  f.setPending(true)
  const pending = f.render(LoginForm, { next: '/courses' })
  const button = tree => nodes(tree).find(n => n.type === 'button')
  assert.equal(button(initial).props.className, button(pending).props.className)
  assert.match(button(pending).props.className, /h-12/)
  assert.equal(button(pending).props.disabled, true)
  assert.deepEqual(f.resets, [])
  const { Feedback } = f.component(9)
  const empty = Feedback({ message: '', reserveSpace: true })
  const error = Feedback({ message: 'Incorrect email or password.', tone: 'error', reserveSpace: true })
  assert.equal(empty.props.className, error.props.className)
  assert.equal(empty.props.children, null)
  assert.match(empty.props.className, /min-h-12/)
  const { FormField } = f.component(8)
  const field = message => nodes(FormField({ id: 'password', label: 'Password', error: message })).find(n => n.props?.id === 'password-error')
  assert.equal(field(''), undefined)
  assert.equal(field('Enter your password.').props.children, 'Enter your password.')
  assert.doesNotMatch(field('Enter your password.').props.className, /min-h-/)
}))

test('logout keeps identical label and geometry while pending and prevents repeat clicks', async () => fixture(async f => {
  const { LogoutButton } = f.component(10)
  const initial = f.render(LogoutButton, { continuityToken: 'fixture-rendered-session' })
  const before = nodes(initial.type(initial.props)).find(n => n.type === 'button')
  f.setPending(true)
  const pending = f.render(LogoutButton, { continuityToken: 'fixture-rendered-session' })
  const after = nodes(pending.type(pending.props)).find(n => n.type === 'button')
  assert.equal(before.props.children, 'Log out')
  assert.equal(after.props.children, before.props.children)
  assert.equal(after.props.className, before.props.className)
  assert.equal(after.props.disabled, true)
  assert.equal(after.props['aria-busy'], true)
}))

test('student logout navigates to login only after the server operation succeeds', async () => fixture(async f => {
  const { LogoutButton } = f.component(10)
  const button = () => {
    const control = f.render(LogoutButton, { continuityToken: 'fixture-rendered-session' })
    return nodes(control.type(control.props)).find(n => n.type === 'button')
  }
  f.fail({ message: AUTH_MESSAGES.unavailable })
  await button().props.onClick()
  assert.deepEqual(f.requests, [{ endpoint: AUTH_API.logout, body: {} }])
  assert.deepEqual(f.destinations, [])
  f.result({ success: true })
  await button().props.onClick()
  assert.deepEqual(f.requests[1], { endpoint: AUTH_API.logout, body: {} })
  assert.deepEqual(f.navigations, [['replace', '/login']])
}))

test('global navigation keeps the locked student destinations and only auth entry for visitors', async () => {
  const { fixture: navigationFixture, nodes: navigationNodes } = require('../../components/chrome/navigation.fixture.cjs')
  await navigationFixture(async f => {
    assert.equal(navigationNodes(f.nav()).filter(node => node.props?.href === '/bookmarks').length, 0)
    await f.respond({ enabled: true, signedIn: true })
    const tree = f.nav()
    assert.equal(navigationNodes(tree).filter(node => node.props?.href === '/bookmarks').length, 0)
    assert.equal(navigationNodes(tree).filter(node => node.props?.href === '/courses').length, 2)
    const actions = navigationNodes(tree).filter(node => node.type?.name === 'NavigationAccountControls')
    assert.deepEqual(actions, [], 'authenticated navigation no longer contains logout')
    f.change(); await f.respond({ enabled: true, signedIn: false })
    const publicActions = navigationNodes(f.nav()).filter(node => node.type?.name === 'NavigationAccountControls')
    assert.equal(publicActions.length, 1)
    assert.equal(publicActions[0].props.signedIn, false)
    assert.equal(navigationNodes(f.nav()).filter(node => node.props?.href === '/bookmarks').length, 0)
  })
})

test('login omits Browse courses and puts secondary actions together in a wrapping row', async () => fixture(async f => {
  const gate = f.component(7).default({ searchParams: Promise.resolve({}) })
  const content = await gate.props.children.type(gate.props.children.props)
  const shell = f.component(13).AuthShell(content.props)
  assert.doesNotMatch(JSON.stringify(shell), /Browse courses/)
  const form = f.render(f.component(4).LoginForm, { next: '/courses' })
  const row = nodes(form).find(n => n.type === 'div' && n.props.className?.includes('flex-wrap'))
  assert.ok(row)
  assert.deepEqual(nodes(row).filter(n => n.props?.href).map(n => n.props.children), ['Forgot password?', 'Create account'])
  assert.match(row.props.className, /gap-y-2/)
}))

test('auth forms keep primary buttons distinct from light secondary navigation', async () => fixture(async f => {
  const { btnBase, btnNavy, focusRingNavy } = require('../../components/chrome/ui.tsx')
  const focus = styleTokens(focusRingNavy)
  for (const token of ['focus-visible:outline', 'focus-visible:outline-2',
    'focus-visible:outline-offset-2', 'focus-visible:outline-student-focus']) {
    assert.ok(focus.has(token), `shared focus must expose ${token}`)
  }
  const forms = [
    f.render(f.component(4).LoginForm, { next: '/dashboard' }),
    f.render(f.component(3).RegisterForm, { next: '/dashboard' }),
    f.render(f.component(14).EmailForm, { recovery: true }),
    f.render(f.component(5).ConfirmEmailForm, { email: 'student@example.test', onStartOver() {} }),
    f.render(f.component(1).ResetPasswordForm, { email: 'student@example.test', onFailure() {} }),
  ]
  for (const form of forms) {
    const layout = f.child(form, 'AuthFormLayout')
    const primary = layout.props.primaryAction
    assert.equal(primary.type, 'button')
    assertUsesStyle(primary, btnBase, btnNavy)
    assertUsesStyle(primary, focusRingNavy)
    assertNoDefaultUnderline(primary)
    for (const link of nodes(layout.props.secondaryActions).filter(node => node.props?.href)) {
      assertUsesStyle(link, focusRingNavy)
      const classes = styleTokens(link.props.className)
      assert.ok(classes.has('min-h-11') && classes.has('hover:bg-student-brand-surface'))
      assert.equal(classes.has('border-[1.5px]') || classes.has('bg-ci-navy'), false,
        'secondary navigation should remain lighter than a button')
      assertNoDefaultUnderline(link)
    }
  }
}))

test('confirmation and recovery actions use secondary buttons; long recovery text can wrap', async () => fixture(async f => {
  const { btnBase, btnGhost, btnNavy, focusRingNavy } = require('../../components/chrome/ui.tsx')
  const confirmation = f.render(f.component(5).ConfirmEmailForm, { email: 'student@example.test', onStartOver() {} })
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  const code = f.child(f.flow(), 'RecoveryCodeForm')
  const recovery = f.render(code.type, code.props)
  for (const form of [confirmation, recovery]) {
    const buttons = nodes(f.child(form, 'AuthFormLayout').props.secondaryActions)
      .filter(node => node.type === 'button')
    assert.equal(buttons.length, 2)
    for (const button of buttons) {
      assert.equal(button.props.type, 'button')
      assertUsesStyle(button, btnBase, btnGhost)
      assertUsesStyle(button, focusRingNavy)
      assertNoDefaultUnderline(button)
    }
  }
  const resend = nodes(recovery).find(node => node.type === 'button' && node.props.children === 'Didn’t receive it? Resend code')
  const resendClasses = styleTokens(resend.props.className)
  assert.ok(resendClasses.has('max-w-full') && resendClasses.has('!whitespace-normal') && resendClasses.has('text-center'))
  assert.ok(nodes(recovery).some(node => node.type === 'div' && styleTokens(node.props.className).has('flex-wrap')))

  // "Password changed" has one action, a primary Sign in button.
  code.props.onVerified()
  f.child(f.flow(), 'ResetPasswordForm').props.onChanged()
  const signIn = nodes(f.flow()).find(node => node.props?.href)
  assert.equal(signIn.props.children, 'Sign in')
  assertUsesStyle(signIn, btnBase, btnNavy)
  assertUsesStyle(signIn, focusRingNavy)
  assertNoDefaultUnderline(signIn)
}))

test('pending navigation re-checks keep known chrome; failed checks are neutral until a definitive answer', async () => {
  const { fixture: navigationFixture, nodes: navigationNodes } = require('../../components/chrome/navigation.fixture.cjs')
  const { renderToStaticMarkup } = require('react-dom/server')
  await navigationFixture(async f => {
    const studentLinksVisible = () => navigationNodes(f.nav()).some(node => node.props?.href === '/courses')
    const neutral = () => {
      assert.equal(studentLinksVisible(), false)
      assert.equal(f.state().status, 'unknown')
      const html = renderToStaticMarkup(navigationNodes(f.nav()).find(node => node.type === 'nav'))
      assert.doesNotMatch(html, /Sign in|Create account|Open menu/)
    }
    assert.equal(studentLinksVisible(), false)
    await f.respond({ error: 'Something went wrong. Please try again.' }, 503)
    neutral()
    f.change(); await f.respond({ enabled: true, signedIn: true })
    assert.equal(studentLinksVisible(), true)
    f.change()
    assert.equal(studentLinksVisible(), true, 'a pending re-check never presents signed-out chrome')
    await f.respond({ error: 'Something went wrong. Please try again.' }, 503)
    neutral()
    f.change(); await f.respond({ enabled: true, signedIn: false })
    assert.equal(studentLinksVisible(), false)
    assert.equal(f.state().status, 'signed-out')
  })
})

test('all six forms share fields-feedback-primary-secondary presentation without owning handlers', async () => fixture(async f => {
  const { AuthFormLayout, AuthSecondaryActions } = require('../../components/auth/AuthFormLayout.tsx')
  const forms = [
    f.render(f.component(4).LoginForm, { next: '/courses' }),
    f.render(f.component(3).RegisterForm, { next: '/courses' }),
    f.render(f.component(5).ConfirmEmailForm, { email: 'student@example.test', onStartOver() {} }),
    f.render(f.component(14).EmailForm, { recovery: true, onRecoveryRequested() {} }),
    f.render(f.component(1).ResetPasswordForm, { email: 'student@example.test', onFailure() {} }),
  ]
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  const recovery = f.child(f.flow(), 'RecoveryCodeForm')
  forms.push(f.render(recovery.type, recovery.props))
  for (const form of forms) {
    assert.equal(form.type, 'form')
    assert.equal(typeof form.props.onSubmit, 'function')
    const layout = f.child(form, 'AuthFormLayout')
    assert.ok(layout)
    assert.equal(layout.props.onSubmit, undefined)
    const rendered = AuthFormLayout(layout.props)
    const regions = rendered.props.children
    assert.equal(regions[0].props.children, layout.props.fields)
    assert.equal(regions[1].props.children.type.name, 'Feedback')
    assert.equal(regions[1].props.children.props.message, layout.props.feedback.message)
    assert.equal(regions[1].props.children.props.tone, layout.props.feedback.tone)
    assert.equal(regions[1].props.children.props.compact, true)
    assert.equal(nodes(rendered).filter(node => node.type?.name === 'Feedback').length, 1)
    assert.equal(regions[1].props.className, 'empty:hidden')
    assert.equal(regions[2].props.children, layout.props.primaryAction)
    if (layout.props.secondaryActions) assert.equal(regions[3].type, AuthSecondaryActions)
    assert.doesNotMatch(JSON.stringify(rendered), /Browse courses|Error:/)
  }
  const confirmation = forms[2]
  const secondary = f.child(confirmation, 'AuthFormLayout').props.secondaryActions
  assert.deepEqual(nodes(secondary).filter(n => n.type === 'button').map(n => n.props.children), ['Resend code', 'Change email'])
  assert.equal(nodes(secondary).some(n => n.props?.href), false)
  assert.equal(nodes(confirmation).find(n => n.type === 'h2').props.children, 'Confirm email')
  assert.doesNotMatch(JSON.stringify(confirmation), /Didn't receive it|Wrong email|Start over|already been used|I have received|Sign in|Forgot password|instructions will arrive/)
  const shell = f.component(13).AuthShell
  for (const title of ['Sign in', 'Create account', 'Check your email', 'Forgot password', 'Reset password']) {
    assert.doesNotMatch(JSON.stringify(shell({ title, children: null })), /Browse courses/)
  }
}))

test('confirmation and recovery OTP error copy is identical without changing failure status', () => {
  const { mapAuthFailure } = require('./errors.ts')
  for (const action of ['otp', 'recoveryOtp']) {
    for (const code of ['otp_expired', 'otp_disabled']) {
      assert.deepEqual(mapAuthFailure({ code, message: 'private provider detail' }, action),
        { status: 400, error: 'Invalid or expired code.' })
    }
  }
  assert.equal(mapAuthFailure({ code: 'invalid_credentials' }, 'login').error, 'Incorrect email or password.')
})


test('password minimum copy appears only as a real validation error, then disappears when cleared', async () => fixture(async f => {
  const message = 'Use at least 8 characters.'
  const forms = [
    f.render(f.component(3).RegisterForm, { next: '/courses' }),
    f.render(f.component(1).ResetPasswordForm, { email: 'student@example.test', onFailure() {} }),
  ]
  for (const form of forms) {
    assert.ok(!JSON.stringify(form).includes(message))
    const password = nodes(form).find(n => n.props?.id === 'password')
    assert.equal(password.props.help, undefined)
    assert.equal(password.props.placeholder, undefined)
    assert.equal(password.props.error, undefined)
  }
  const { passwordSchema } = require('./schemas.ts')
  const invalid = passwordSchema.safeParse('short')
  assert.equal(invalid.success, false)
  const error = invalid.error.issues[0].message
  assert.equal(error, message)
  const { FormField } = f.component(8)
  const props = { id: 'password', label: 'Password' }
  for (const value of [undefined, error, undefined]) {
    const field = FormField({ ...props, error: value })
    const input = nodes(field).find(n => n.type === 'input')
    assert.equal(input.props['aria-invalid'], !!value)
    assert.equal(nodes(field).find(n => n.props?.id === 'password-help'), undefined)
    const row = nodes(field).find(n => n.props?.id === 'password-error')
    if (value) {
      assert.equal(row.props.children, message)
      assert.equal(input.props['aria-describedby'], 'password-error')
    } else {
      assert.equal(row, undefined)
      assert.ok(!JSON.stringify(field).includes(message))
      assert.equal(input.props['aria-describedby'], undefined)
    }
  }
}))

test('confirmation and recovery requests continue directly to code entry; failures stay on the request form', async () => fixture(async f => {
  const { EmailForm } = f.component(14)
  for (const recovery of [false, true]) {
    let requested
    const props = { recovery, onRecoveryRequested: email => { requested = email } }
    let form = f.render(EmailForm, props)
    f.setValues({ email: 'student@example.test' })
    f.fail({ message: AUTH_MESSAGES.unavailable })
    await form.props.onSubmit()
    form = f.render(EmailForm, props)
    assert.equal(form.type, 'form')
    assert.equal(requested, undefined)
    assert.equal(f.child(form, 'Feedback').props.message, AUTH_MESSAGES.unavailable)
    f.result({ message: recovery ? AUTH_MESSAGES.recovery : AUTH_MESSAGES.email })
    await form.props.onSubmit()
    if (recovery) {
      assert.equal(requested, 'student@example.test')
      assert.equal(f.render(EmailForm, props).type, 'form')
      continue
    }
    const confirmation = f.render(EmailForm, props)
    assert.equal(confirmation.type.name, 'ConfirmEmailForm')
    assert.equal(confirmation.props.email, 'student@example.test')
    const content = JSON.stringify(f.render(confirmation.type, confirmation.props))
    assert.doesNotMatch(content, /We sent|A new code has been sent|I have received|instructions will arrive/)
    confirmation.props.onStartOver()
    assert.equal(f.render(EmailForm, props).type, 'form')
  }
}))

test('confirmation resend says a new code was sent to the address; the line goes on the next attempt, valid or not', async () => fixture(async f => {
  const { ConfirmEmailForm } = f.component(5)
  const props = { email: 'student@example.test', onStartOver() {} }
  const sent = 'We sent a new code to student@example.test.'
  const resend = form => nodes(form).find(n => n.type === 'button' && n.props.children === 'Resend code').props.onClick()
  const form = f.render(ConfirmEmailForm, props)
  // The server's answer is the same for every address; the screen adds the address the student typed.
  f.result({ message: AUTH_MESSAGES.email })
  await resend(form)
  let after = f.render(ConfirmEmailForm, props)
  assert.equal(f.child(after, 'Feedback').props.message, sent)
  assert.equal(f.child(after, 'Feedback').props.tone, 'info', 'the same neutral line as on the reset code step')
  assert.doesNotMatch(JSON.stringify(after), /instructions will arrive|If this address/)
  f.setValues({ code: '' })
  await after.props.onSubmit()
  assert.equal(f.requests.length, 1, 'an empty code is never sent')
  assert.equal(f.child(f.render(ConfirmEmailForm, props), 'Feedback').props.message, '', 'but the attempt clears the line')
  await resend(form)
  f.fail({ message: AUTH_MESSAGES.code })
  f.setValues({ code: '123456' })
  await after.props.onSubmit()
  const failed = f.render(ConfirmEmailForm, props)
  assert.equal(nodes(failed).filter(node => node.type?.name === 'Feedback').length, 1)
  assert.equal(f.child(failed, 'Feedback').props.message, AUTH_MESSAGES.code)
  assert.ok(!JSON.stringify(failed).includes(sent))
  assert.ok(f.resets.includes('code'), 'a refused code is cleared for the next one')
  // The failure goes the same way on the next attempt.
  f.setValues({ code: '' })
  await failed.props.onSubmit()
  assert.equal(f.child(f.render(ConfirmEmailForm, props), 'Feedback').props.message, '')
  assert.equal(f.destinations.length, 0)
}))

test('a confirmed code keeps the form busy until the next page: no re-enabled button, no cleared field', async () => fixture(async f => {
  const { ConfirmEmailForm } = f.component(5)
  const props = { email: 'student@example.test', next: '/courses', onStartOver() {} }
  const form = f.render(ConfirmEmailForm, props)
  f.result({ next: '/courses' })
  f.setValues({ code: '123456' })
  await form.props.onSubmit()
  assert.deepEqual(f.destinations, ['/courses'])
  assert.deepEqual(f.resets, [], 'the code stays in its field while the page moves on')
  const moving = f.render(ConfirmEmailForm, props)
  const buttons = nodes(moving).filter(node => node.type === 'button')
  assert.deepEqual(buttons.map(node => [node.props.children, node.props.disabled]),
    [['Confirming…', true], ['Resend code', true], ['Change email', true]])
  assert.equal(nodes(moving).find(node => node.props?.id === 'code').props.disabled, true)
}))

test('every other form clears its last message on the next attempt, valid or not', async () => fixture(async f => {
  const message = form => f.child(form, 'Feedback').props.message
  // The email step: the notice it was opened with, then a failure.
  const { EmailForm } = f.component(14)
  const emailProps = { recovery: true, onRecoveryRequested() {}, initialFeedback: { message: AUTH_MESSAGES.recoveryRestart, tone: 'error' } }
  let form = f.render(EmailForm, emailProps)
  assert.equal(message(form), 'Request a new code to continue.')
  f.setValues({ email: '' }); await form.props.onSubmit()
  assert.equal(message(f.render(EmailForm, emailProps)), '')
  f.fail({ message: AUTH_MESSAGES.limited }); f.setValues({ email: 'student@example.test' }); await form.props.onSubmit()
  assert.equal(message(f.render(EmailForm, emailProps)), AUTH_MESSAGES.limited)
  f.setValues({ email: 'not-an-email' }); await form.props.onSubmit()
  assert.equal(message(f.render(EmailForm, emailProps)), '')
  // The recovery code step: the resend line, then a failure.
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  const code = f.child(f.flow(), 'RecoveryCodeForm')
  form = f.render(code.type, code.props)
  f.result({ message: AUTH_MESSAGES.recovery })
  await nodes(form).find(node => node.type === 'button' && node.props.children === "Didn't receive it? Resend code").props.onClick()
  assert.equal(message(f.render(code.type, code.props)), 'We sent a new code to student@example.test.')
  f.setValues({ code: '' }); await form.props.onSubmit()
  assert.equal(message(f.render(code.type, code.props)), '')
  f.fail({ message: AUTH_MESSAGES.recoveryCode }); f.setValues({ code: '123456' }); await form.props.onSubmit()
  assert.equal(message(f.render(code.type, code.props)), 'Invalid or expired code.')
  f.setValues({ code: 'not-numeric' }); await form.props.onSubmit()
  assert.equal(message(f.render(code.type, code.props)), '')
  // Create account: a failure.
  const { RegisterForm } = f.component(3)
  form = f.render(RegisterForm, { next: '/courses' })
  f.fail({ message: AUTH_MESSAGES.limited })
  f.setValues({ email: 'student@example.test', password: 'Test-password-only', confirmation: 'Test-password-only' }); await form.props.onSubmit()
  assert.equal(message(f.render(RegisterForm, { next: '/courses' })), AUTH_MESSAGES.limited)
  f.setValues({ email: 'student@example.test', password: 'short', confirmation: 'short' }); await form.props.onSubmit()
  assert.equal(message(f.render(RegisterForm, { next: '/courses' })), '')
}))

test('a new password longer than the provider accepts is turned away on the screen, before any request', async () => fixture(async f => {
  const { resetSchema } = require('./schemas.ts')
  const parse = password => resetSchema.safeParse({ email: 'student@example.test', password })
  assert.equal(parse('p'.repeat(72)).success, true)
  const tooLong = parse('p'.repeat(73))
  assert.equal(tooLong.success, false)
  assert.equal(tooLong.error.issues[0].message, 'Use no more than 72 characters.')
  assert.equal(parse('é'.repeat(36)).success, true, '72 bytes')
  // The limit is the provider's, counted in bytes: 37 accented letters are already over it, so the line names no
  // number of characters.
  const tooManyBytes = parse('é'.repeat(37))
  assert.equal(tooManyBytes.success, false)
  assert.deepEqual(tooManyBytes.error.issues.map(issue => issue.message), ['Use a shorter password.'])
  assert.deepEqual(parse('é'.repeat(73)).error.issues.map(issue => issue.message), ['Use no more than 72 characters.'])
  // On the screen nothing is sent, so the grant is never touched and the student simply types another.
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  f.child(f.flow(), 'RecoveryCodeForm').props.onVerified()
  const reset = f.child(f.flow(), 'ResetPasswordForm')
  const form = f.render(reset.type, reset.props)
  f.setValues({ password: 'p'.repeat(73), confirmation: 'p'.repeat(73) }); await form.props.onSubmit()
  assert.equal(f.requests.length, 0)
  assert.equal(f.flow().props.title, 'Change password')
  f.result({}); f.setValues({ password: 'p'.repeat(72), confirmation: 'p'.repeat(72) }); await form.props.onSubmit()
  assert.equal(f.requests.length, 1)
}))

test('the code has one name on every screen', async () => fixture(async f => {
  const { EmailForm } = f.component(14)
  for (const recovery of [false, true]) {
    const request = f.render(EmailForm, { recovery, onRecoveryRequested() {} })
    assert.equal(nodes(request).find(node => node.type === 'button').props.children, 'Send code')
    assert.equal(f.child(request, 'AuthFormLayout').props.secondaryActions, undefined)
  }
  const confirmation = f.render(f.component(5).ConfirmEmailForm, { email: 'student@example.test', onStartOver() {} })
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  const code = f.child(f.flow(), 'RecoveryCodeForm')
  const recovery = f.render(code.type, code.props)
  for (const form of [confirmation, recovery]) {
    assert.equal(nodes(form).find(node => node.props?.id === 'code').props.label, 'Code')
    assert.match(JSON.stringify(form), /Enter the code you received at /)
    assert.doesNotMatch(JSON.stringify(form), /verification code|recovery code|reset code|confirmation code/i)
  }
  const copy = JSON.stringify([AUTH_MESSAGES, 'We sent a new code to student@example.test.'])
  assert.doesNotMatch(copy, /verification code|recovery code|reset code|confirmation code|instructions will arrive/i)
  assert.equal(AUTH_MESSAGES.recoveryRestart, 'Request a new code to continue.')
}))
