const assert = require('node:assert/strict')
const { BookmarkStore } = require('./store.ts')
const { BOOKMARK_REQUEST_DEADLINE_MS } = require('./contract.ts')

const catalog = Array.from({ length: 3 }, (_, index) => ({
  slug: `course-${index}`, code: `CODE${index}`, contentKey: `content-${index}`,
}))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
// Event-loop fence, not an elapsed-time sleep. Mocked transport work drains first.
const flush = () => new Promise(setImmediate)

async function fixture(run, initial = []) {
  const original = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout }
  const timers = new Map(), values = new Map(), accounts = new Map([['a', new Set(initial)], ['b', new Set([catalog[2].contentKey])]])
  let nextTimer = 0, owner = 'a'
  const calls = [], notices = [], receipts = new Map()
  const storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }
  const ready = (actor = owner) => actor === null ? { status: 'signed-out' } : ({
    status: 'ready', courseKeys: [...accounts.get(actor)], ownerMarker: actor.toUpperCase().repeat(43), continuityToken: `token-${actor}`,
    courseIds: catalog.map((course, index) => ({ contentKey: course.contentKey,
      courseId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` })),
  })
  const commit = (command, actor = owner) => {
    const keys = accounts.get(actor)
    if (command.action === 'merge') {
      const receipt = `${actor}:${command.reconciliationId}`
      if (receipts.has(receipt)) assert.deepEqual(command.courseIds, receipts.get(receipt))
      else {
        receipts.set(receipt, [...command.courseIds])
        for (const id of command.courseIds) keys.add(catalog[Number(id.slice(-12)) - 1].contentKey)
      }
    } else if (command.action === 'add') keys.add(command.contentKey)
    else keys.delete(command.contentKey)
    return ready(actor)
  }
  let read = async () => ready(), verify = async token => token === `token-${owner}` ? 'same' : 'changed'
  let write = async (command, token, actor) => token === `token-${actor}` ? commit(command, actor) : { status: 'session-changed' }
  const transport = {
    read: signal => { calls.push(['read', owner, signal]); return read(signal) },
    verify: (token, signal) => { calls.push(['verify', token, signal]); return verify(token, signal) },
    write: (command, token) => { calls.push(['write', command, token, owner]); return write(command, token, owner) },
  }
  try {
    global.setTimeout = (callback, delay) => {
      assert.equal(delay, BOOKMARK_REQUEST_DEADLINE_MS)
      const id = ++nextTimer; timers.set(id, callback); return id
    }
    global.clearTimeout = id => { timers.delete(id) }
    const store = new BookmarkStore(() => storage, transport, () => notices.push(store.getSnapshot()), 'closed')
    store.configure(catalog)
    await run({ store, storage, values, calls, notices, accounts, ready, commit,
      read: fn => { read = fn }, verify: fn => { verify = fn }, write: fn => { write = fn },
      owner: value => { owner = value }, expire: () => {
        assert.ok(timers.size, 'a real store deadline must be armed')
        for (const [id, callback] of [...timers]) { timers.delete(id); callback() }
      }, timers })
    assert.equal(timers.size, 0, 'settled operations leave no dangling deadline')
  } finally { Object.assign(global, original) }
}
module.exports = { fixture, catalog, deferred, flush }
