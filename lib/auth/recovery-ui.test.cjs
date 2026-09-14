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
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
}

// Exercise the actual components, retaining hooks separately for each mounted component.
async function fixture(run) {
  const original = Module._load
  const originalTsx = Module._extensions['.tsx']
  const oldWindow = global.window
  const states = new Map()
  let active, index, values = {}, nextFailure
  const requests = [], destinations = [], resets = []
  let nextResult = {}
  const submit = async (endpoint, body, onFailure) => {
    requests.push({ endpoint, body })
    if (nextFailure) { const failure = nextFailure; nextFailure = undefined; onFailure?.(failure); return null }
    return nextResult
  }
  const hooks = {
    ...React,
    useState(initial) {
      const state = active, slot = index++
      if (!(slot in state)) state[slot] = initial
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value }]
    },
    useRef: () => ({ current: null }), useEffect: () => {},
    forwardRef: fn => fn,
  }
  const files = ['../../app/forgot-password/RecoveryFlow.tsx', '../../app/reset-password/ResetPasswordForm.tsx', '../../app/reset-password/page.tsx', '../../app/register/RegisterForm.tsx', '../../app/login/LoginForm.tsx', '../../app/confirm-email/ConfirmEmailForm.tsx', '../../app/confirm-email/page.tsx']
  const paths = files.map(file => require.resolve(file))
  try {
    const forbiddenStorage = new Proxy({}, { get() { throw new Error('Recovery must not use persistent browser storage') } })
    global.window = { location: { assign: destination => destinations.push(destination) }, localStorage: forbiddenStorage, sessionStorage: forbiddenStorage }
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'react') return hooks
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => true }
      if (name === '@/components/auth/useAuthSubmit') return { useAuthSubmit: () => ({ submit, pending: false, error: '' }) }
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
    await run({ flow, render, child, requests, destinations, resets, component: i => require(paths[i]), result: value => { nextResult = value }, setValues: v => { values = v }, fail: f => { nextFailure = f }, direct: () => { const gate = require(paths[2]).default(); return gate.props.children.type(gate.props.children.props) } })
  } finally {
    Module._load = original
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow
    for (const path of paths) delete require.cache[path]
  }
}

test('recovery has display-only email, local code validation, password-only stage and one final payload', async () => fixture(async f => {
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  let tree = f.flow()
  assert.equal(tree.props.title, 'Check your email')
  let code = f.child(tree, 'RecoveryCodeForm')
  let form = f.render(code.type, code.props)
  assert.deepEqual(nodes(form).filter(n => n.type?.name === 'FormField').map(n => n.props.id), ['code'])
  assert.ok(JSON.stringify(form).includes('student@example.test'))
  for (const value of ['', 'not-numeric']) {
    f.setValues({ code: value }); await form.props.onSubmit()
    assert.equal(f.flow().props.title, 'Check your email')
  }
  f.setValues({ code: '123456' }); await form.props.onSubmit()
  assert.equal(f.requests.length, 0)
  tree = f.flow(); assert.equal(tree.props.title, 'Choose a new password')
  const password = f.child(tree, 'ResetPasswordForm')
  form = f.render(password.type, password.props)
  assert.deepEqual(nodes(form).filter(n => n.props?.id).map(n => n.props.id), ['password', 'confirmation'])
  assert.ok(!JSON.stringify(form).includes('student@example.test'))
  f.setValues({ password: 'Test-password-only', confirmation: 'Test-password-only' })
  await form.props.onSubmit()
  assert.deepEqual(f.requests, [{ endpoint: AUTH_API.reset, body: { email: 'student@example.test', code: '123456', password: 'Test-password-only' } }])
  assert.deepEqual(f.destinations, [PASSWORD_RESET_DESTINATION])
}))

test('invalid code returns to code entry; consumed-code failure destroys recovery context', async () => fixture(async f => {
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  for (const code of [RECOVERY_FAILURE.invalidCode, RECOVERY_FAILURE.restart]) {
    f.child(f.flow(), 'RecoveryCodeForm').props.onContinue('123456')
    const password = f.child(f.flow(), 'ResetPasswordForm')
    const form = f.render(password.type, password.props)
    f.fail({ code, message: AUTH_MESSAGES.code })
    f.setValues({ password: 'Test-password-only', confirmation: 'Test-password-only' })
    await form.props.onSubmit()
    assert.equal(f.flow().props.title, code === RECOVERY_FAILURE.invalidCode ? 'Check your email' : 'Forgot password')
    assert.equal(f.child(f.flow(), 'ResetPasswordForm'), undefined)
  }
  assert.equal(f.destinations.length, 0)
}))

test('resend uses bound email; start-over clears flow; direct reset offers guidance only', async () => fixture(async f => {
  f.child(f.flow(), 'EmailForm').props.onRecoveryRequested('student@example.test')
  const code = f.child(f.flow(), 'RecoveryCodeForm')
  const form = f.render(code.type, code.props)
  const buttons = nodes(form).filter(node => node.type === 'button')
  await buttons.find(node => node.props.children === "Didn't receive it? Resend code").props.onClick()
  assert.deepEqual(f.requests, [{ endpoint: AUTH_API.forgot, body: { email: 'student@example.test' } }])
  buttons.find(node => node.props.children === 'Wrong email? Start over').props.onClick()
  assert.equal(f.flow().props.title, 'Forgot password')
  assert.equal(f.child(f.flow(), 'RecoveryCodeForm'), undefined)
  const direct = f.direct()
  assert.ok(JSON.stringify(direct).includes('Start from Forgot password to request a reset code.'))
  assert.equal(f.child(direct, 'ResetPasswordForm'), undefined)
  assert.equal(f.destinations.length, 0)
}))


test('registration and unconfirmed login clear passwords and keep confirmation email bound until start-over', async () => fixture(async f => {
  for (const [index, exportName] of [[3, 'RegisterForm'], [4, 'LoginForm']]) {
    const component = f.component(index)[exportName]
    let form = f.render(component, { next: '/courses' })
    f.result(index === 4 ? { code: 'EMAIL_CONFIRMATION_REQUIRED', delivery: 'limited' } : {})
    f.setValues({ email: 'student@example.test', password: 'Test-password-only', ...(index === 3 ? { confirmation: 'Test-password-only' } : {}) })
    await form.props.onSubmit()
    assert.ok(f.resets.includes(index === 3 ? 'all' : 'password'))
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
