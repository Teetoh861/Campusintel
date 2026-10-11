// Shared two-document Web Lock fixture for the real Auth submit hook.
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AsyncLocalStorage } = require('node:async_hooks')
const { AUTH_API, AUTH_MESSAGES, STUDENT_HOME_PATH, PASSWORD_RESET_DESTINATION } = require('./constants.ts')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body } }
function success(endpoint) {
  if (endpoint === AUTH_API.logout || endpoint === AUTH_API.cancelRecovery) return { success: true }
  if (endpoint === AUTH_API.reset) return { next: PASSWORD_RESET_DESTINATION }
  if (endpoint === AUTH_API.login || endpoint === AUTH_API.confirm) return { next: STUDENT_HOME_PATH }
  if (endpoint === AUTH_API.verifyRecovery) return { verified: true }
  return { message: endpoint === AUTH_API.forgot ? AUTH_MESSAGES.recovery : AUTH_MESSAGES.email }
}

async function fixture(run) {
  const load = Module._load, cache = new Map(Object.entries(require.cache))
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const saved = { window: global.window, fetch: global.fetch }
  const context = new AsyncLocalStorage(), events = [], requests = [], notifications = [], redirects = []
  const queue = []
  let active = false, transport = async endpoint => response(success(endpoint)), lockFailure = false
  // The two documents share only an origin LockManager and the simulated browser
  // cookie jar. Each has independent hook state. No timer decides ordering.
  const manager = {
    request(name, options, callback) {
      const document = context.getStore()
      events.push(['request-lock', document.name, name, options.mode])
      if (lockFailure === 'throw') throw new Error('private browser capability failure')
      if (lockFailure) return Promise.reject(new Error('private browser capability failure'))
      return new Promise((resolve, reject) => {
        queue.push({ document, name, callback, resolve, reject })
        drain()
      })
    },
  }
  function drain() {
    if (active || !queue.length) return
    active = true
    const job = queue.shift()
    events.push(['acquire', job.document.name])
    const complete = (settle, value) => {
      events.push(['release', job.document.name]); active = false
      settle(value); drain()
    }
    Promise.resolve().then(() => context.run(job.document, () => job.callback({ name: job.name, mode: 'exclusive' })))
      .then(value => complete(job.resolve, value), error => complete(job.reject, error))
  }
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: manager } })
    global.window = { location: { replace: path => { redirects.push([context.getStore().name, path]) } } }
    global.fetch = async (endpoint, options) => {
      const document = context.getStore().name
      requests.push({ document, endpoint, options }); events.push(['fetch', document, endpoint])
      return transport(endpoint, options, document)
    }
    Module._load = function (name, ...args) {
      if (name === 'react') return {
        useRef(initial) {
          const document = context.getStore(), slot = document.index++
          if (!(slot in document.slots)) document.slots[slot] = { current: initial }
          return document.slots[slot]
        },
        useState(initial) {
          const document = context.getStore(), slot = document.index++
          if (!(slot in document.slots)) document.slots[slot] = initial
          return [document.slots[slot], value => { document.slots[slot] = value }]
        },
      }
      if (name === '@/lib/auth/client-events') return { notifyStudentChange: () => {
        const document = context.getStore().name
        assert.equal(active, true, 'notification must occur before releasing the Web Lock')
        notifications.push(document); events.push(['notify', document])
      } }
      return load.call(this, name, ...args)
    }
    const hookFile = require.resolve('../../components/auth/useAuthSubmit.ts')
    delete require.cache[hookFile]
    const { useAuthSubmit } = require(hookFile)
    const transition = require('./client-transition.ts')
    const tab = name => {
      const document = { name, slots: [], index: 0 }
      const view = () => context.run(document, () => { document.index = 0; return useAuthSubmit() })
      return { view, submit: (...args) => context.run(document, () => view().submit(...args)) }
    }
    await run({ tab, transition, requests, notifications, redirects, events,
      transport: fn => { transport = fn }, unavailable: () => {
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
      }, failLock: value => { lockFailure = value } })
  } finally {
    Module._load = load
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator); else delete globalThis.navigator
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value }
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

module.exports = { fixture, deferred, response, success }
