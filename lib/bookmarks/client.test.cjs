const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('actual bookmark transport forwards cancellation only to GET/verification and preserves private write context', async () => {
  const load = Module._load, fetch = global.fetch, file = require.resolve('./client.ts')
  const requests = [], marker = 'A'.repeat(43)
  let transport
  const ready = { status: 'ready', courseKeys: ['course'], ownerMarker: marker, continuityToken: 'page-token',
    courseIds: [{ contentKey: 'course', courseId: '40000000-0000-4000-8000-000000000001' }] }
  try {
    Module._load = function (name, ...args) {
      if (name === './store' && args[0]?.filename === file) return { BookmarkStore: class {
        constructor(storage, provided, notify, mode) { transport = provided; assert.equal(mode, 'closed') }
      } }
      return load.call(this, name, ...args)
    }
    delete require.cache[file]; require(file)
    global.fetch = async (url, options) => {
      requests.push({ url, options })
      return Response.json(url === '/api/auth/session' ? { enabled: true, signedIn: true, sameAccount: true } : ready)
    }
    const controller = new AbortController()
    assert.deepEqual(await transport.read(controller.signal), ready)
    assert.equal(await transport.verify('page-token', controller.signal), 'same')
    assert.equal(requests[0].options.signal, controller.signal)
    assert.equal(requests[1].options.signal, controller.signal)
    assert.equal(requests[1].options.headers['x-campus-account-continuity'], 'page-token')
    for (const command of [{ action: 'add', contentKey: 'course' }, { action: 'remove', contentKey: 'course' },
      { action: 'merge', reconciliationId: '50000000-0000-4000-8000-000000000001', courseIds: [ready.courseIds[0].courseId] }]) {
      assert.deepEqual(await transport.write(command, 'page-token'), ready)
      const request = requests.at(-1)
      assert.equal(request.options.method, 'POST'); assert.equal(request.options.credentials, 'same-origin')
      assert.equal(request.options.cache, 'no-store'); assert.equal('signal' in request.options, false)
      assert.equal(request.options.headers['x-campus-account-continuity'], 'page-token')
      assert.deepEqual(JSON.parse(request.options.body), command)
    }
    global.fetch = async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    const read = transport.read(controller.signal)
    controller.abort(); await assert.rejects(read, /aborted/)
  } finally {
    Module._load = load; global.fetch = fetch; delete require.cache[file]
  }
})
