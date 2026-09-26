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

function nodes(element) {
  if (!element || typeof element !== 'object') return []
  if (['AuthFormLayout', 'AuthSecondaryActions'].includes(element.type?.name)) {
    return [element, ...nodes(element.type(element.props))]
  }
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
}

function styleTokens(value) { return new Set((value || '').split(/\s+/).filter(Boolean)) }

function assertUsesStyle(node, primitive) {
  const actual = styleTokens(node.props.className)
  for (const token of styleTokens(primitive)) {
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
  const originalTsx = Module._extensions['.tsx']
  const oldWindow = global.window
  const states = new Map()
  let active, index, values = {}, nextFailure, submissionError = ''
  const requests = [], destinations = [], navigations = [], historyChanges = [], resets = [], effects = []
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
    useRef: () => ({ current: null }), useEffect: effect => { effects.push(effect) },
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
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => true }
      if (name === '@/components/auth/useAuthSubmit' || name === './useAuthSubmit') return { useAuthSubmit: () => ({ submit, pending, error: submissionError }) }
      if (name === 'react-hook-form') return { ...hookForm, useForm: options => ({
        register: name => ({ name }), formState: { errors: {} }, reset: () => { resets.push('all'); values = {} }, resetField: name => { resets.push(name); delete values[name] },
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
    await run({ flow, render, child, requests, destinations, navigations, historyChanges, resets, effects, setState: (component, slot, value) => { states.get(component)[slot] = value }, setPending: value => { pending = value }, component: i => require(paths[i]), result: value => { nextResult = value }, setValues: v => { values = v }, fail: f => { nextFailure = f }, direct: () => { const gate = require(paths[2]).default(); return gate.props.children.type(gate.props.children.props) } })
  } finally {
    Module._load = original
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow
    for (const path of paths) delete require.cache[path]
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
  assert.deepEqual(f.destinations, [PASSWORD_RESET_DESTINATION])
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
  assert.deepEqual(buttons.map(node => node.props.children), ['Continue', "Didn't receive it? Resend code", 'Change email'])
  assert.doesNotMatch(JSON.stringify(form), /Wrong email\?|Start over/)
  await buttons.find(node => node.props.children === "Didn't receive it? Resend code").props.onClick()
  assert.deepEqual(f.requests, [{ endpoint: AUTH_API.forgot, body: { email: 'student@example.test' } }])
  let resent = f.render(code.type, code.props)
  assert.equal(f.child(resent, 'Feedback').props.message, AUTH_MESSAGES.recovery)
  f.result(null)
  await nodes(resent).find(node => node.type === 'button' && node.props.children === 'Change email').props.onClick()
  assert.deepEqual(f.requests[1], { endpoint: AUTH_API.cancelRecovery, body: {} })
  resent = f.render(code.type, code.props)
  assert.equal(f.child(resent, 'Feedback').props.message, '')
  assert.equal(f.flow().props.title, 'Check your email')
  f.result({ success: true })
  await nodes(resent).find(node => node.type === 'button' && node.props.children === 'Change email').props.onClick()
  assert.deepEqual(f.requests[2], { endpoint: AUTH_API.cancelRecovery, body: {} })
  assert.equal(f.flow().props.title, 'Forgot password')
  assert.equal(f.child(f.flow(), 'RecoveryCodeForm'), undefined)
  const direct = f.direct()
  assert.ok(JSON.stringify(direct).includes('Start from Forgot password to request a reset code.'))
  assert.equal(f.child(direct, 'ResetPasswordForm'), undefined)
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
  const gate = f.component(6).default()
  const direct = gate.props.children.type(gate.props.children.props)
  assert.ok(JSON.stringify(direct).includes('Start from sign up or sign in'))
  assert.equal(f.child(direct, 'ConfirmEmailForm'), undefined)
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

test('recovery success destination renders the exact login notice, and feedback has no error prefix', async () => fixture(async f => {
  assert.equal(PASSWORD_RESET_DESTINATION, '/login?state=password-reset')
  const gate = f.component(7).default({ searchParams: Promise.resolve({ state: 'password-reset' }) })
  const page = await gate.props.children.type(gate.props.children.props)
  assert.equal(page.props.title, 'Sign in')
  const login = f.child(page, 'LoginForm')
  assert.equal(login.props.initialFeedback, 'Password updated. Sign in with your new password.')
  let form = f.render(login.type, login.props)
  assert.equal(nodes(form).filter(node => node.type?.name === 'Feedback').length, 1)
  assert.equal(f.child(form, 'Feedback').props.message, AUTH_MESSAGES.resetSuccess)
  assert.equal(f.child(form, 'Feedback').props.tone, 'success')
  f.fail({ message: AUTH_MESSAGES.credentials })
  f.setValues({ email: 'student@example.test', password: 'wrong-password' })
  await form.props.onSubmit()
  form = f.render(login.type, login.props)
  assert.equal(nodes(form).filter(node => node.type?.name === 'Feedback').length, 1)
  assert.equal(f.child(form, 'Feedback').props.message, AUTH_MESSAGES.credentials)
  assert.equal(f.child(form, 'Feedback').props.tone, 'error')
  assert.ok(!JSON.stringify(form).includes(AUTH_MESSAGES.resetSuccess))
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
  const initial = f.render(LogoutButton)
  const before = nodes(initial.type(initial.props)).find(n => n.type === 'button')
  f.setPending(true)
  const pending = f.render(LogoutButton)
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
    const control = f.render(LogoutButton)
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

test('responsive navigation shares auth actions and always retains Bookmarks', async () => fixture(async f => {
  const { Nav } = f.component(12)
  const { AuthNavActions } = f.component(11)
  const renderNav = () => f.render(Nav)
  const initial = renderNav()
  const placeholders = nodes(initial).filter(n => n.type === AuthNavActions)
  assert.equal(placeholders.length, 2)
  assert.ok(placeholders.every(n => n.props.signedIn === null))
  for (const signedIn of [false, true]) {
    f.setState(Nav, 1, { enabled: true, signedIn })
    f.setPending(signedIn)
    const nav = renderNav()
    const links = nodes(nav).filter(n => n.props?.href === '/bookmarks')
    assert.equal(links.length, 2)
    const actions = nodes(nav).filter(n => n.type === AuthNavActions)
    assert.deepEqual(actions.map(n => n.props.surface), ['blue', 'paper'])
    assert.equal(actions[0].props.logout, actions[1].props.logout)
    for (const action of actions) {
      const tree = f.render(action.type, action.props)
      const text = JSON.stringify(tree)
      assert.ok(text.includes(signedIn ? 'Account' : 'Sign in'))
      assert.equal(text.includes('Dashboard'), signedIn)
      const destinations = nodes(tree).filter(n => typeof n.props?.href === 'string').map(n => n.props.href)
      assert.deepEqual(destinations, signedIn ? ['/dashboard', '/account'] : ['/login', '/register'])
      assert.equal(text.includes('Create account'), !signedIn)
      assert.equal(tree.props.className, f.render(AuthNavActions, { ...action.props, signedIn: null }).props.className)
      if (signedIn) {
        const control = f.child(tree, 'LogoutControl')
        const button = nodes(control.type(control.props)).find(n => n.type === 'button')
        assert.equal(button.props.children, 'Log out')
        assert.equal(button.props.disabled, true)
      }
    }
  }
  f.setState(Nav, 1, { enabled: false, signedIn: false })
  assert.equal(nodes(renderNav()).filter(n => n.type === AuthNavActions).length, 0)
  assert.equal(nodes(renderNav()).filter(n => n.props?.href === '/bookmarks').length, 2)
}))

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
  for (const token of ['focus-visible:outline', 'focus-visible:outline-1',
    'focus-visible:outline-offset-2', 'focus-visible:outline-ci-navy']) {
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
    assertUsesStyle(primary, btnBase)
    assertUsesStyle(primary, btnNavy)
    assertUsesStyle(primary, focusRingNavy)
    assertNoDefaultUnderline(primary)
    for (const link of nodes(layout.props.secondaryActions).filter(node => node.props?.href)) {
      assertUsesStyle(link, focusRingNavy)
      const classes = styleTokens(link.props.className)
      assert.ok(classes.has('min-h-11') && classes.has('hover:bg-ci-blue-50'))
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
      assertUsesStyle(button, btnBase)
      assertUsesStyle(button, btnGhost)
      assertUsesStyle(button, focusRingNavy)
      assertNoDefaultUnderline(button)
    }
  }
  const resend = nodes(recovery).find(node => node.type === 'button' && node.props.children === "Didn't receive it? Resend code")
  const resendClasses = styleTokens(resend.props.className)
  assert.ok(resendClasses.has('max-w-full') && resendClasses.has('!whitespace-normal') && resendClasses.has('text-center'))
  assert.ok(nodes(recovery).some(node => node.type === 'div' && styleTokens(node.props.className).has('flex-wrap')))

  const confirmGate = f.component(6).default()
  const confirmDirect = confirmGate.props.children.type(confirmGate.props.children.props)
  const confirmLinks = nodes(confirmDirect).filter(node => node.props?.href)
  assert.equal(confirmLinks.length, 2)
  for (const link of confirmLinks) {
    assertUsesStyle(link, btnBase)
    assertUsesStyle(link, btnGhost)
    assertUsesStyle(link, focusRingNavy)
    assertNoDefaultUnderline(link)
  }
  const resetLink = nodes(f.direct()).find(node => node.props?.href)
  assertUsesStyle(resetLink, btnBase)
  assertUsesStyle(resetLink, btnNavy)
  assertUsesStyle(resetLink, focusRingNavy)
  assertNoDefaultUnderline(resetLink)
}))

test('pending and failed checks preserve confirmed navigation, while revoked-session status signs it out', async () => fixture(async f => {
  const saved = { fetch: global.fetch, document: global.document, BroadcastChannel: global.BroadcastChannel }
  const events = new Map()
  let resolve
  global.window.addEventListener = (name, listener) => events.set(name, listener)
  global.window.removeEventListener = name => events.delete(name)
  global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  global.BroadcastChannel = class { close() {} }
  global.fetch = () => new Promise(done => { resolve = done })
  let cleanup
  try {
    const { Nav } = f.component(12)
    const actions = () => f.child(f.render(Nav), 'AuthNavActions')
    assert.equal(actions().props.signedIn, null)
    cleanup = f.effects[0]()
    resolve(Response.json({ error: 'Something went wrong. Please try again.' }, { status: 503 }))
    await new Promise(done => setImmediate(done))
    assert.equal(actions().props.signedIn, null) // Failure cannot invent disabled or signed-out state.
    events.get('focus')()
    resolve(Response.json({ enabled: true, signedIn: true }))
    await new Promise(done => setImmediate(done))
    assert.equal(actions().props.signedIn, true)
    events.get('focus')()
    assert.equal(actions().props.signedIn, true)
    resolve(Response.json({}, { status: 503 }))
    await new Promise(done => setImmediate(done))
    assert.equal(actions().props.signedIn, true)
    events.get('focus')()
    assert.equal(actions().props.signedIn, true)
    resolve(Response.json({ enabled: true, signedIn: false }))
    await new Promise(done => setImmediate(done))
    assert.equal(actions().props.signedIn, false)
  } finally {
    cleanup?.()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete global[key]; else global[key] = value
    }
  }
}))

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

test('confirmation resend acknowledges the request without claiming a fresh code was sent', async () => fixture(async f => {
  const { ConfirmEmailForm } = f.component(5)
  const props = { email: 'student@example.test', onStartOver() {} }
  const form = f.render(ConfirmEmailForm, props)
  f.result({ message: AUTH_MESSAGES.email })
  await nodes(form).find(n => n.type === 'button' && n.props.children === 'Resend code').props.onClick()
  const after = f.render(ConfirmEmailForm, props)
  assert.equal(f.child(after, 'Feedback').props.message, AUTH_MESSAGES.email)
  assert.doesNotMatch(JSON.stringify(after), /We sent|A new code has been sent/)
  f.fail({ message: AUTH_MESSAGES.code })
  f.setValues({ code: '123456' })
  await after.props.onSubmit()
  const failed = f.render(ConfirmEmailForm, props)
  assert.equal(nodes(failed).filter(node => node.type?.name === 'Feedback').length, 1)
  assert.equal(f.child(failed, 'Feedback').props.message, AUTH_MESSAGES.code)
  assert.ok(!JSON.stringify(failed).includes(AUTH_MESSAGES.email))
  assert.equal(f.destinations.length, 0)
}))
