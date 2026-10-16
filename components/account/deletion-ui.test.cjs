const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { randomUUID } = require('node:crypto')
const { fixture } = require('../student/control-fixture.cjs')

async function controls(run) {
  await fixture(async f => {
    const load = Module._load, calls = [], destinations = []
    const state = { pending: false, error: '' }
    f.state.pending = false
    global.window.location = { replace: path => destinations.push(path), reload: () => destinations.push('reload') }
    Module._load = function (name, ...args) {
      if (name === '@/components/auth/useAuthSubmit') return { useAuthSubmit: () => ({ ...state,
        submit: async (...input) => {
          calls.push(input)
          return input[0] === '/api/auth/logout' ? { success: true } : { next: '/dashboard' }
        },
      }) }
      return load.call(this, name, ...args)
    }
    await run({ ...f, state, calls, destinations })
  })
}

test('mandatory decision makes no request on mount, and only Yes cancels with the original rendered request/session', async () => controls(async f => {
  const { DeletionDecision } = require('./DeletionDecision.tsx')
  const requestId = randomUUID(), view = f.mount(DeletionDecision, { requestId, continuityToken: 'rendered-A' })
  let tree = view.render()
  assert.equal(f.calls.length, 0, 'login/render cannot imply consent')
  view.props = { requestId: randomUUID(), continuityToken: 'rendered-B' }
  tree = view.render()
  const buttons = f.nodes(tree).filter(node => node.type === 'button')
  assert.deepEqual(buttons.map(node => node.props.children), ['Yes, keep my account', 'No, continue with deletion'])
  await buttons[0].props.onClick()
  assert.equal(f.calls[0][0], '/api/auth/cancel-deletion')
  assert.deepEqual(f.calls[0][1], { requestId })
  assert.equal(f.calls[0][3].continuityToken, 'rendered-A')
  await buttons[1].props.onClick()
  assert.equal(f.calls[1][0], '/api/auth/logout')
  assert.deepEqual(f.calls[1][1], {})
  assert.equal(f.calls[1][3].continuityToken, 'rendered-A')
  assert.deepEqual(f.destinations, ['/dashboard', '/login'])
  f.state.pending = true
  assert.ok(f.nodes(view.render()).filter(node => node.type === 'button').every(node => node.props.disabled))
}))

test('deletion confirmation requires current password and explicit consent, and does not expose a scheduling form until opened', async () => controls(async f => {
  const { DeleteAccountForm } = require('./DeleteAccountForm.tsx')
  const view = f.mount(DeleteAccountForm, { continuityToken: 'rendered-A' })
  let tree = view.render()
  assert.equal(f.calls.length, 0)
  assert.equal(f.nodes(tree).filter(node => node.type === 'form').length, 0)
  f.nodes(tree).find(node => node.type === 'button').props.onClick()
  tree = view.render()
  const field = f.nodes(tree).find(node => node.props.name === 'password')
  assert.equal(field.props.type, 'password'); assert.equal(field.props.autoComplete, 'current-password')
  assert.equal(field.props.required, true); assert.equal(field.props.maxLength, 128)
  const consent = f.nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox')
  assert.equal(consent.props.required, true)
  const oldFormData = global.FormData
  let resets = 0
  const currentPassword = randomUUID()
  try {
    global.FormData = class { get(name) { return name === 'password' ? currentPassword : 'on' } }
    await f.nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: { reset() { resets++ } } })
  } finally { global.FormData = oldFormData }
  assert.equal(f.calls[0][0], '/api/auth/schedule-deletion')
  assert.deepEqual(f.calls[0][1], { password: currentPassword, confirmed: true })
  assert.equal(f.calls[0][3].continuityToken, 'rendered-A')
  assert.equal(resets, 1, 'password entry is cleared after the attempt')
  f.state.pending = true
  const pending = f.nodes(view.render())
  assert.ok(pending.filter(node => node.type === 'button').every(node => node.props.disabled))
  assert.equal(pending.find(node => node.props.name === 'password').props.disabled, true)
}))

test('deletion disclosure keeps a stable ARIA target, exposes expansion and returns focus to the trigger on close', async () => controls(async f => {
  const { DeleteAccountForm } = require('./DeleteAccountForm.tsx')
  let focused = null
  const triggerElement = { focus() { focused = triggerElement } }
  const view = f.mount(DeleteAccountForm, { continuityToken: 'rendered-A' }, { onCommit: tree => {
    f.nodes(tree).find(node => node.type === 'button' && node.props['aria-controls']).props.ref.current = triggerElement
  } })
  const disclosure = () => {
    const tree = view.render(), nodes = f.nodes(tree)
    const trigger = nodes.find(node => node.type === 'button' && node.props['aria-controls'])
    const panel = nodes.find(node => node.props.id === trigger.props['aria-controls'])
    assert.ok(panel, 'aria-controls always refers to a mounted panel')
    return { trigger, panel, nodes }
  }
  let rendered = disclosure()
  assert.equal(rendered.trigger.props['aria-expanded'], false); assert.equal(rendered.panel.props.hidden, true)
  for (const closeFrom of ['Go back', 'trigger']) {
    rendered.trigger.props.onClick(); rendered = disclosure()
    assert.equal(rendered.trigger.props['aria-expanded'], true); assert.equal(rendered.panel.props.hidden, false)
    assert.equal(rendered.nodes.find(node => node.props.name === 'password').props.autoFocus, true)
    const close = closeFrom === 'trigger' ? rendered.trigger
      : rendered.nodes.find(node => node.type === 'button' && node.props.children === closeFrom)
    focused = null; close.props.onClick(); rendered = disclosure()
    assert.equal(rendered.trigger.props['aria-expanded'], false); assert.equal(rendered.panel.props.hidden, true)
    assert.equal(focused, triggerElement)
    assert.equal(rendered.nodes.some(node => node.type === 'form'), false, 'closing discards password/consent controls')
  }
}))
