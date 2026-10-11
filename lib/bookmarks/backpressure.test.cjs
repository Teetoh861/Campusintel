const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture, catalog, deferred, flush } = require('./backpressure-fixture.cjs')
const { BOOKMARK_STORAGE_KEY } = require('./local.ts')

test('1000 even / 1001 odd same-course toggles have one shared completion and only necessary writes', async () => {
  for (const count of [1000, 1001]) await fixture(async f => {
    await f.store.refresh()
    const held = deferred()
    let first = true
    f.write(async (command, token, actor) => { if (first) { first = false; await held.promise } return f.commit(command, actor) })
    const callers = Array.from({ length: count }, () => f.store.toggle(catalog[0]))
    assert.equal(new Set(callers).size, 1, 'store does not retain a promise/waiter per click')
    assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
    assert.deepEqual(f.store.getSnapshot().keys, [], 'desired state never lies about durability')
    held.resolve()
    const results = await Promise.all(callers)
    assert.ok(results.every(result => result === (count % 2 ? 'added' : 'removed')))
    assert.deepEqual(f.calls.filter(call => call[0] === 'write').map(call => call[1].action), count % 2 ? ['add'] : ['add', 'remove'])
    assert.deepEqual(f.store.getSnapshot().keys, count % 2 ? [catalog[0].contentKey] : [])
  })
})

test('multi-course bursts retain one desired state per configured identity and reject arbitrary keys', async () => fixture(async f => {
  await f.store.refresh()
  const held = deferred(); let first = true
  f.write(async (command, token, actor) => { if (first) { first = false; await held.promise } return f.commit(command, actor) })
  const callers = []
  for (const [index, count] of [[0, 1000], [1, 1001], [2, 1001]]) {
    for (let click = 0; click < count; click++) callers.push(f.store.toggle(catalog[index]))
  }
  assert.equal(new Set(callers).size, 3)
  const invalid = Array.from({ length: 1000 }, (_, index) => f.store.toggle({ ...catalog[0], contentKey: `unknown-${index}` }))
  assert.ok((await Promise.all(invalid)).every(result => result === null))
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  held.resolve(); assert.ok((await Promise.all(callers)).every(result => result !== null))
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 4)
  assert.deepEqual([...f.store.getSnapshot().keys].sort(), [catalog[1].contentKey, catalog[2].contentKey])
}))

test('1000 repeated removals coalesce to one DELETE and all callers settle true', async () => fixture(async f => {
  await f.store.refresh()
  const held = deferred()
  f.write(async (command, token, actor) => { await held.promise; return f.commit(command, actor) })
  const callers = Array.from({ length: 1000 }, () => f.store.remove(catalog[0]))
  assert.equal(new Set(callers).size, 1)
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  held.resolve(); assert.ok((await Promise.all(callers)).every(Boolean))
  assert.deepEqual(f.store.getSnapshot().keys, [])
}, [catalog[0].contentKey]))

test('remove followed by toggle returns false when the coalesced burst finishes saved', async () => fixture(async f => {
  await f.store.refresh()
  const held = deferred()
  f.write(async (command, token, actor) => {
    if (command.action === 'remove') await held.promise
    return f.commit(command, actor)
  })
  const removal = f.store.remove(catalog[0])
  const toggle = f.store.toggle(catalog[0])
  assert.deepEqual(f.calls.filter(call => call[0] === 'write').map(call => call[1].action), ['remove'])
  held.resolve()
  const [removeResult, toggleResult] = await Promise.all([removal, toggle])
  assert.equal(removeResult, false)
  assert.equal(toggleResult, 'added')
  assert.deepEqual(f.calls.filter(call => call[0] === 'write').map(call => call[1].action), ['remove', 'add'])
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: [catalog[0].contentKey] })
  assert.equal(f.accounts.get('a').has(catalog[0].contentKey), true)
}, [catalog[0].contentKey]))

test('timed-out ADD quarantines forever while unresolved; late commit cannot be overtaken and requires authoritative recovery', async () => fixture(async f => {
  await f.store.refresh()
  const held = deferred(), recovery = deferred()
  let command, actor
  f.write(async (input, token, owner) => { command = input; actor = owner; await held.promise; f.commit(input, owner); return { ...f.ready(owner), courseKeys: ['untrusted-late-payload'] } })
  const callers = [f.store.toggle(catalog[0]), f.store.toggle(catalog[0])]
  f.expire()
  assert.deepEqual(await Promise.all(callers), [null, null])
  assert.deepEqual(f.store.getSnapshot(), { mode: 'unavailable', keys: [] })
  for (let index = 0; index < 100; index++) {
    assert.equal(await f.store.toggle(catalog[0]), null)
    assert.equal(await f.store.remove(catalog[0]), false)
    await f.store.refresh()
  }
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 1, 'no work overtakes the unresolved mutation')
  f.read(() => recovery.promise)
  held.resolve(); await flush()
  assert.equal(command.action, 'add'); assert.equal(actor, 'a')
  assert.equal(f.accounts.get('a').has(catalog[0].contentKey), true)
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 2, 'one recovery read')
  assert.deepEqual(f.store.getSnapshot(), { mode: 'unavailable', keys: [] })
  assert.equal(await f.store.remove(catalog[0]), false, 'even a settled old write cannot be followed before refresh succeeds')
  recovery.resolve(f.ready()); await flush()
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: [catalog[0].contentKey] })
  f.write(async (input, token, owner) => f.commit(input, owner))
  assert.equal(await f.store.remove(catalog[0]), true)
  assert.deepEqual(f.calls.filter(call => call[0] === 'write').map(call => call[1].action), ['add', 'remove'])
  assert.deepEqual(f.store.getSnapshot().keys, [])
}))

test('late rejected write is observed without retry; failed recovery stays closed until deliberate refresh', async () => fixture(async f => {
  await f.store.refresh()
  const held = deferred(); f.write(() => held.promise)
  const caller = f.store.toggle(catalog[0]); f.expire(); assert.equal(await caller, null)
  f.read(async () => ({ status: 'unavailable' }))
  held.reject(new Error('late network failure')); await flush()
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 2)
  assert.equal(await f.store.toggle(catalog[0]), null)
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  f.read(async () => f.ready()); await f.store.refresh()
  f.write(async (command, token, actor) => f.commit(command, actor))
  assert.equal(await f.store.toggle(catalog[0]), 'added')
}))

test('read and verify deadlines abort only read-only work and leave no indefinite loading', async () => {
  for (const stage of ['read', 'verify']) await fixture(async f => {
    const held = deferred(); let signal
    if (stage === 'read') f.read(input => { signal = input; return held.promise })
    else f.verify((token, input) => { signal = input; return held.promise })
    const pending = f.store.refresh(); await flush()
    assert.equal(signal.aborted, false)
    f.expire(); await pending
    assert.equal(signal.aborted, true)
    assert.deepEqual(f.store.getSnapshot(), { mode: 'unavailable', keys: [] })
    assert.equal(await f.store.toggle(catalog[0]), null)
    held.resolve(stage === 'read' ? f.ready() : 'same'); await flush()
    assert.equal(f.store.getSnapshot().mode, 'unavailable', 'late read does not install')
    assert.equal(f.calls.some(call => call[0] === 'write'), false)
  })
})

test('100 refresh triggers share one run plus one rerun, and stale A never installs into B', async () => fixture(async f => {
  const held = deferred(); let first = true
  f.read(async () => { if (first) { first = false; return held.promise } return f.ready() })
  const firstRun = f.store.refresh()
  f.owner('b')
  const storm = Array.from({ length: 100 }, () => f.store.refresh())
  assert.ok(storm.every(promise => promise === firstRun))
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 1)
  const installed = []; f.store.subscribe(() => installed.push(f.store.getSnapshot()))
  held.resolve(f.ready('a')); await Promise.all(storm)
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 2)
  assert.equal(installed.some(snapshot => snapshot.keys.includes(catalog[0].contentKey)), false)
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: [catalog[2].contentKey] })
}))

test('refresh invalidation drops A callers and never replays A desired state under B', async () => fixture(async f => {
  await f.store.refresh()
  const held = deferred(); f.write(async (command, token, actor) => { await held.promise; return f.commit(command, actor) })
  const callers = [f.store.toggle(catalog[0]), f.store.toggle(catalog[1])]
  f.owner('b'); await f.store.refresh()
  assert.deepEqual(await Promise.all(callers), [null, null])
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 1, 'refresh waits for old mutation')
  held.resolve(); await flush()
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: [catalog[2].contentKey] })
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  assert.deepEqual([...f.accounts.get('b')], [catalog[2].contentKey])
  assert.equal(f.storage.getItem(BOOKMARK_STORAGE_KEY), null)
}))

test('ordinary failure / continuity loss settles the entire burst without replay or optimistic state', async () => {
  for (const mode of ['unavailable', 'throw', 'signed-out', 'session-changed', 'wrong-owner', 'verify-changed', 'verify-unavailable', 'bad-ack']) await fixture(async f => {
    await f.store.refresh()
    const held = deferred()
    f.write(async (command, token, actor) => {
      await held.promise
      if (mode === 'throw') throw new Error('network')
      if (['unavailable', 'signed-out', 'session-changed'].includes(mode)) {
        if (mode === 'signed-out') f.owner(null)
        if (mode === 'session-changed') f.owner('b')
        return { status: mode }
      }
      const saved = f.commit(command, actor)
      if (mode === 'verify-changed') f.owner('b')
      return mode === 'wrong-owner' ? { ...saved, ownerMarker: 'B'.repeat(43) }
        : mode === 'bad-ack' ? { ...saved, courseKeys: [] } : saved
    })
    if (mode === 'verify-changed') f.verify(async token => token === 'token-b' ? 'same' : 'changed')
    if (mode === 'verify-unavailable') f.verify(async () => 'unavailable')
    const callers = [f.store.toggle(catalog[0]), f.store.toggle(catalog[1])]
    held.resolve(); assert.deepEqual(await Promise.all(callers), [null, null]); await flush()
    assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
    if (['unavailable', 'throw'].includes(mode)) assert.deepEqual(f.store.getSnapshot().keys, [])
    else if (['verify-changed', 'session-changed'].includes(mode)) assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: [catalog[2].contentKey] })
    else assert.equal(f.store.getSnapshot().mode, 'unavailable')
    assert.equal(f.storage.getItem(BOOKMARK_STORAGE_KEY), null)
  })
})

test('merge deadlines use the same quarantined lane and recover the original reconciliation receipt', async () => fixture(async f => {
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify([catalog[0].slug]))
  const held = deferred(); let first = true
  f.write(async (command, token, actor) => { if (first) { first = false; await held.promise } return f.commit(command, actor) })
  const loading = f.store.refresh(); await flush()
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  f.expire(); await loading
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
  assert.equal(await f.store.toggle(catalog[1]), null)
  for (let index = 0; index < 100; index++) await f.store.refresh()
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  held.resolve(); await flush()
  const merges = f.calls.filter(call => call[0] === 'write').map(call => call[1])
  assert.equal(merges.length, 1, 'late receipt acknowledgement needs no automatic mutation retry')
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: [catalog[0].contentKey] })
}))

test('an unacknowledged timed-out merge is not retried automatically; deliberate refresh reuses its receipt', async () => fixture(async f => {
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify([catalog[0].slug]))
  const held = deferred(); f.write(() => held.promise)
  const loading = f.store.refresh(); await flush(); f.expire(); await loading
  const original = f.calls.find(call => call[0] === 'write')[1]
  held.reject(new Error('unknown merge result')); await flush()
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
  assert.equal(await f.store.toggle(catalog[1]), null)
  f.write(async (command, token, actor) => f.commit(command, actor))
  await f.store.refresh()
  const replay = f.calls.filter(call => call[0] === 'write')[1][1]
  assert.equal(replay.reconciliationId, original.reconciliationId)
  assert.deepEqual(replay.courseIds, original.courseIds)
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: [catalog[0].contentKey] })
}))

test('post-write verification timeout settles the burst and aborts verification without aborting/retrying the mutation', async () => fixture(async f => {
  await f.store.refresh()
  let signal
  const held = deferred(); f.verify((token, input) => { signal = input; return held.promise })
  const caller = f.store.toggle(catalog[0]); await flush()
  assert.equal(f.accounts.get('a').has(catalog[0].contentKey), true)
  assert.deepEqual(f.store.getSnapshot().keys, [], 'unverified acknowledgement is not installed')
  f.expire(); assert.equal(await caller, null)
  assert.equal(signal.aborted, true); assert.equal(f.store.getSnapshot().mode, 'unavailable')
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  held.resolve('same'); await flush()
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
}))

test('refresh demand during the coalesced follow-up still produces only one additional rerun', async () => fixture(async f => {
  const first = deferred(), second = deferred(); let reads = 0
  f.read(() => ++reads === 1 ? first.promise : reads === 2 ? second.promise : Promise.resolve(f.ready()))
  const loading = f.store.refresh()
  const storm1 = Array.from({ length: 100 }, () => f.store.refresh())
  assert.equal(reads, 1)
  first.resolve(f.ready()); await flush(); assert.equal(reads, 2)
  const storm2 = Array.from({ length: 100 }, () => f.store.refresh())
  assert.equal(reads, 2)
  second.resolve(f.ready()); await Promise.all([loading, ...storm1, ...storm2])
  assert.equal(reads, 3); assert.equal(f.store.getSnapshot().mode, 'account')
}))

test('late merge acknowledgement never resurrects a subsequent other-device deletion during read-only recovery', async () => fixture(async f => {
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify([catalog[0].slug]))
  const held = deferred()
  f.write(async (command, token, actor) => { await held.promise; return f.commit(command, actor) })
  const loading = f.store.refresh(); await flush(); f.expire(); await loading
  f.read(async () => { f.accounts.get('a').delete(catalog[0].contentKey); return f.ready() })
  held.resolve(); await flush()
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: [] })
  assert.equal(f.accounts.get('a').size, 0)
}))

test('a late acknowledgement cannot consume an escrow whose pinned payload was tampered', async () => fixture(async f => {
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify([catalog[0].slug]))
  const held = deferred()
  f.write(async (command, token, actor) => { await held.promise; return f.commit(command, actor) })
  const loading = f.store.refresh(); await flush(); f.expire(); await loading
  const key = [...f.values.keys()].find(value => value.startsWith('ci_bookmarks_v1_pending:'))
  const pending = JSON.parse(f.storage.getItem(key))
  pending.batches[0].courseIds = [f.ready().courseIds[1].courseId]
  f.storage.setItem(key, JSON.stringify(pending))
  held.resolve(); await flush()
  assert.equal(f.calls.filter(call => call[0] === 'write').length, 1)
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
  assert.equal(f.storage.getItem(key), JSON.stringify(pending))
  assert.equal(await f.store.toggle(catalog[1]), null)
}))
