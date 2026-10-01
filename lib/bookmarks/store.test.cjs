// lib/bookmarks/store.test.cjs — Local/account import and shared-state regressions.
// Run with lib/auth/test-loader.cjs preloaded.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { BookmarkStore } = require('./store.ts')
const { BOOKMARK_STORAGE_KEY, parseLocalBookmarkKeys,
  resolveLocalCourseKeys, writeAnonymousKeys } = require('./local.ts')
const { MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE } = require('./contract.ts')

const catalog = [
  { slug: 'first-slug', code: 'FIRST101', contentKey: 'first-content' },
  { slug: 'second-slug', code: 'SECOND102', contentKey: 'second-content' },
  { slug: 'third-slug', code: 'THIRD103', contentKey: 'third-content' },
]
const marker = { a: 'A'.repeat(43), b: 'B'.repeat(43) }

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

function fixture(initial = {}, availableCatalog = catalog) {
  const storage = new MemoryStorage()
  const accounts = new Map(Object.entries(initial).map(([owner, keys]) => [owner, new Set(keys)]))
  let activeCatalog = availableCatalog
  const idsByKey = new Map()
  const keysById = new Map()
  const courseId = key => {
    if (!idsByKey.has(key)) {
      const id = `40000000-0000-4000-8000-${String(idsByKey.size + 1).padStart(12, '0')}`
      idsByKey.set(key, id)
      keysById.set(id, key)
    }
    return idsByKey.get(key)
  }
  let current = null
  let failMerge = false
  let dropMergeBeforeCommit = false
  let loseMergeAcknowledgement = false
  let failWrite = false
  const calls = []
  const appliedImports = new Map()
  const state = () => current === null ? { status: 'signed-out' } : {
    status: 'ready', courseKeys: [...(accounts.get(current) ?? new Set())],
    continuityToken: `token-${current}`, ownerMarker: marker[current],
    courseIds: activeCatalog.map(course => ({ contentKey: course.contentKey,
      courseId: courseId(course.contentKey) })),
  }
  const transport = {
    async read() { calls.push(['read', current]); return state() },
    async verify(token) { calls.push(['verify', current]); return token === `token-${current}` ? 'same' : 'changed' },
    async write(command, token) {
      calls.push(['write', current, command, token])
      if (token !== `token-${current}`) return { status: 'session-changed' }
      if (command.action === 'merge' && dropMergeBeforeCommit) {
        dropMergeBeforeCommit = false
        throw new Error('connection lost before commit')
      }
      if (command.action === 'merge' && failMerge || command.action !== 'merge' && failWrite) {
        return { status: 'unavailable' }
      }
      const keys = accounts.get(current) ?? new Set()
      if (command.action === 'merge') {
        const imports = appliedImports.get(current) ?? new Map()
        const payload = [...new Set(command.courseIds)].sort()
        if (imports.has(command.reconciliationId)) {
          assert.deepEqual(imports.get(command.reconciliationId), payload,
            'a retry cannot change its original import')
        } else {
          imports.set(command.reconciliationId, payload)
          command.courseIds.forEach(id => {
            assert.ok(keysById.has(id), 'the course ID came from a server-provided registry')
            keys.add(keysById.get(id))
          })
        }
        appliedImports.set(current, imports)
        accounts.set(current, keys)
        if (loseMergeAcknowledgement) {
          loseMergeAcknowledgement = false
          throw new Error('connection lost after commit')
        }
      }
      else if (command.action === 'add') keys.add(command.contentKey)
      else keys.delete(command.contentKey)
      accounts.set(current, keys)
      return state()
    },
  }
  const store = new BookmarkStore(() => storage, transport)
  store.configure(availableCatalog)
  return { store, storage, accounts, calls, transport, courseId,
    setCatalog(next) { activeCatalog = next; store.configure(next) },
    signIn(owner) { current = owner },
    failMerge(value) { failMerge = value },
    dropMergeBeforeCommit() { dropMergeBeforeCommit = true },
    loseMergeAcknowledgement() { loseMergeAcknowledgement = true },
    failWrite(value) { failWrite = value },
  }
}

test('signed-out JSON-string bookmarks remain local and synchronize duplicate controls', async () => {
  const f = fixture()
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['first-slug', 'FIRST101', 'SECOND102', null, 7, 'unknown']))
  let notifications = 0
  f.store.subscribe(() => { notifications++ })
  f.store.subscribe(() => { notifications++ })
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'local')
  assert.deepEqual(resolveLocalCourseKeys(f.store.getSnapshot().keys, catalog), ['first-content', 'second-content'])
  assert.equal(await f.store.toggle(catalog[0]), 'removed')
  assert.equal(f.store.getSnapshot().keys.includes('first-slug'), false)
  assert.equal(f.store.getSnapshot().keys.includes('FIRST101'), false)
  assert.equal(await f.store.toggle(catalog[0]), 'added')
  assert.equal(f.storage.getItem(BOOKMARK_STORAGE_KEY).includes('first-slug'), true)
  assert.equal(await f.store.remove(catalog[1]), true)
  assert.equal(f.store.getSnapshot().keys.includes('SECOND102'), false)
  assert.ok(notifications >= 8, 'both same-document subscribers observe each state change')
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['third-slug']))
  f.store.onAnonymousStorageChange()
  assert.deepEqual(f.store.getSnapshot().keys, ['third-slug'])
  assert.equal(f.calls.some(call => call[0] === 'write'), false)
})

test('malformed and unknown local entries are ignored safely', () => {
  assert.deepEqual(parseLocalBookmarkKeys('{broken'), [])
  assert.deepEqual(parseLocalBookmarkKeys('{"not":"an array"}'), [])
  assert.deepEqual(parseLocalBookmarkKeys(JSON.stringify(['', 5, null, 'a', 'a', 'x'.repeat(64)])), ['a'])
  assert.deepEqual(resolveLocalCourseKeys(['unknown', 'first-slug', 'FIRST101'], catalog), ['first-content'])
})

test('unavailable signed-out storage keeps a safe in-memory toggle', async () => {
  const f = fixture()
  f.storage.setItem = () => { throw new Error('storage unavailable') }
  await f.store.refresh()
  assert.equal(await f.store.toggle(catalog[0]), 'added')
  assert.deepEqual(f.store.getSnapshot().keys, ['first-slug'])
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot().keys, ['first-slug'])
  assert.equal(await f.store.toggle(catalog[0]), 'removed')
  assert.deepEqual(f.store.getSnapshot().keys, [])
})

test('signed-in first contact merges the local and remote sets, then remote state survives reload', async () => {
  const f = fixture({ a: ['third-content'] })
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify([
    'first-slug', 'FIRST101', 'SECOND102', 'unknown', false,
  ]))
  f.signIn('a')
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'account')
  assert.deepEqual(f.store.getSnapshot().keys, ['third-content', 'first-content', 'second-content'])
  const imports = f.calls.filter(call => call[2]?.action === 'merge').map(call => call[2])
  assert.equal(imports.length, 1)
  assert.match(imports[0].reconciliationId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  assert.deepEqual(imports[0].courseIds, [f.courseId('first-content'), f.courseId('second-content')])
  assert.equal(f.storage.getItem(BOOKMARK_STORAGE_KEY), null)
  assert.equal(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`), null)
  assert.equal(await f.store.toggle(catalog[0]), 'removed')
  assert.equal(await f.store.toggle(catalog[0]), 'added')
  assert.equal(await f.store.remove(catalog[1]), true)
  const next = new BookmarkStore(() => f.storage, f.transport)
  next.configure(catalog)
  await next.refresh()
  assert.deepEqual(next.getSnapshot().keys, ['third-content', 'first-content'])
  assert.equal(f.calls.filter(call => call[2]?.action === 'merge').length, 1)
})

test('a second device sees the same account set and its removal reaches the first device', async () => {
  const f = fixture({ a: [] })
  f.signIn('a')
  await f.store.refresh()
  assert.equal(await f.store.toggle(catalog[0]), 'added')
  const secondStorage = new MemoryStorage()
  const secondDevice = new BookmarkStore(() => secondStorage, f.transport)
  secondDevice.configure(catalog)
  await secondDevice.refresh()
  assert.deepEqual(secondDevice.getSnapshot().keys, ['first-content'])
  assert.equal(await secondDevice.remove(catalog[0]), true)
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot().keys, [])
})

test('failed reconciliation keeps a private retry copy and account switching cannot import it', async () => {
  const f = fixture({ a: [], b: ['third-content'] })
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['first-slug', 'unknown']))
  f.signIn('a')
  f.failMerge(true)
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
  assert.equal(f.storage.getItem(BOOKMARK_STORAGE_KEY), null)
  assert.deepEqual(JSON.parse(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`)).batches[0].courseIds,
    [f.courseId('first-content')])
  f.signIn('b')
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: ['third-content'] })
  assert.deepEqual([...f.accounts.get('b')], ['third-content'])
  f.signIn('a')
  f.failMerge(false)
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot().keys, ['first-content'])
  assert.equal(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`), null)
  assert.equal(await f.store.remove(catalog[0]), true)
  const reloaded = new BookmarkStore(() => f.storage, f.transport)
  reloaded.configure(catalog)
  await reloaded.refresh()
  assert.deepEqual(reloaded.getSnapshot().keys, [], 'consumed local state never restores a deleted bookmark')
})

test('a committed merge with a lost acknowledgement cannot resurrect a later cross-device deletion', async () => {
  const f = fixture({ a: [] })
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['first-slug']))
  f.signIn('a')
  f.loseMergeAcknowledgement()
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
  assert.deepEqual([...f.accounts.get('a')], ['first-content'], 'the first merge committed')
  const pending = JSON.parse(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`))
  assert.deepEqual(pending.batches[0].courseIds, [f.courseId('first-content')])

  const otherDevice = new BookmarkStore(() => new MemoryStorage(), f.transport)
  otherDevice.configure(catalog)
  await otherDevice.refresh()
  assert.equal(await otherDevice.remove(catalog[0]), true)
  assert.deepEqual([...f.accounts.get('a')], [])

  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: [] })
  assert.deepEqual([...f.accounts.get('a')], [], 'replayed import did not restore the deletion')
  assert.equal(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`), null)
  const imports = f.calls.filter(call => call[2]?.action === 'merge').map(call => call[2])
  assert.equal(imports.length, 2)
  assert.equal(imports[0].reconciliationId, pending.id)
  assert.equal(imports[1].reconciliationId, pending.id)
})

test('an uncommitted merge with an unavailable acknowledgement retries the same import', async () => {
  const f = fixture({ a: ['second-content'] })
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['first-slug']))
  f.signIn('a')
  f.dropMergeBeforeCommit()
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
  assert.deepEqual([...f.accounts.get('a')], ['second-content'])
  const pending = JSON.parse(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`))
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot().keys, ['second-content', 'first-content'])
  assert.equal(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`), null)
  const imports = f.calls.filter(call => call[2]?.action === 'merge').map(call => call[2])
  assert.equal(imports.length, 2)
  assert.equal(imports[0].reconciliationId, pending.id)
  assert.equal(imports[1].reconciliationId, pending.id)
})

// A later deployment renames an alias and newly recognizes an unknown legacy
// entry. A pending import must replay its original canonical payload.
const redeployedCatalog = [
  { slug: 'renamed-first', code: 'FIRST101', contentKey: 'first-content' },
  { slug: 'first-slug', code: 'FOURTH104', contentKey: 'fourth-content' },
  { slug: 'unknown', code: 'FIFTH105', contentKey: 'fifth-content' },
]

test('a committed import replays its original payload after a catalogue alias change', async () => {
  const f = fixture({ a: [] })
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['first-slug', 'unknown']))
  f.signIn('a')
  f.loseMergeAcknowledgement()
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
  assert.deepEqual([...f.accounts.get('a')], ['first-content'])
  const otherDevice = new BookmarkStore(() => new MemoryStorage(), f.transport)
  otherDevice.configure(catalog)
  await otherDevice.refresh()
  assert.equal(await otherDevice.remove(catalog[0]), true)

  f.setCatalog(redeployedCatalog)
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: [] },
    'the replay is recognized and the later deletion stays deleted')
  const imports = f.calls.filter(call => call[2]?.action === 'merge').map(call => call[2])
  assert.equal(imports.length, 2)
  assert.equal(imports[1].reconciliationId, imports[0].reconciliationId)
  assert.deepEqual(imports[1].courseIds, imports[0].courseIds)
  assert.deepEqual(imports[1].courseIds, [f.courseId('first-content')])
  assert.equal(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`), null)
})

test('an uncommitted import retries its original payload after a catalogue alias change', async () => {
  const f = fixture({ a: [] })
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['first-slug', 'unknown']))
  f.signIn('a')
  f.dropMergeBeforeCommit()
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
  assert.deepEqual([...f.accounts.get('a')], [])

  f.setCatalog(redeployedCatalog)
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot(), { mode: 'account', keys: ['first-content'] },
    'the intended import lands; a newly recognized legacy entry does not')
  const imports = f.calls.filter(call => call[2]?.action === 'merge').map(call => call[2])
  assert.equal(imports.length, 2)
  assert.equal(imports[1].reconciliationId, imports[0].reconciliationId)
  assert.deepEqual(imports[1].courseIds, [f.courseId('first-content')])
  assert.equal(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`), null)
})

// More built courses than one bounded reconciliation request may carry.
const largeCatalog = Array.from({ length: MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE + 8 }, (_, index) => ({
  slug: `large-${index}-slug`, code: `LRG${index}`, contentKey: `large-${index}-content`,
}))

test('a local set larger than one request reconciles completely in bounded receipts', async () => {
  const f = fixture({ a: [] }, largeCatalog)
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(largeCatalog.map(course => course.slug)))
  f.signIn('a')
  f.loseMergeAcknowledgement()
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'account')
  assert.deepEqual([...f.store.getSnapshot().keys].sort(),
    largeCatalog.map(course => course.contentKey).sort())
  const imports = f.calls.filter(call => call[2]?.action === 'merge').map(call => call[2])
  assert.equal(imports.length, 3, 'first batch, its replay, then the second batch')
  assert.ok(imports.every(command => command.courseIds.length <= MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE))
  assert.equal(imports[1].reconciliationId, imports[0].reconciliationId)
  assert.deepEqual(imports[1].courseIds, imports[0].courseIds)
  assert.notEqual(imports[2].reconciliationId, imports[0].reconciliationId)
  assert.equal(new Set(imports.flatMap(command => command.courseIds)).size, largeCatalog.length)
  assert.equal(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`), null)
})

test('a later batch that fails before commit retries under its own pinned receipt', async () => {
  const f = fixture({ a: [] }, largeCatalog)
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(largeCatalog.map(course => course.code)))
  f.signIn('a')
  const original = f.transport.write
  let merges = 0
  f.transport.write = async (command, token) => {
    if (command.action === 'merge' && ++merges === 2) throw new Error('connection lost before commit')
    return original(command, token)
  }
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'unavailable')
  assert.equal(f.accounts.get('a').size, MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE)
  f.setCatalog(catalog)
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'account')
  assert.equal(f.accounts.get('a').size, largeCatalog.length,
    'the pinned second batch survives a catalogue that no longer lists it')
  // The fake records only requests that reached it: batch one, its
  // receipt-recognized replay, then the previously lost second batch.
  const imports = f.calls.filter(call => call[2]?.action === 'merge').map(call => call[2])
  assert.equal(imports.length, 3)
  assert.equal(imports[1].reconciliationId, imports[0].reconciliationId)
  assert.deepEqual(imports[1].courseIds, imports[0].courseIds)
  assert.notEqual(imports[2].reconciliationId, imports[0].reconciliationId)
  assert.equal(imports[2].courseIds.length, largeCatalog.length - MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE)
})

test('new anonymous edits become a separate import after an unacknowledged batch', async () => {
  const f = fixture({ a: [] })
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['first-slug']))
  f.signIn('a')
  f.loseMergeAcknowledgement()
  await f.store.refresh()
  writeAnonymousKeys(f.storage, ['second-slug'])
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot().keys, ['first-content', 'second-content'])
  const imports = f.calls.filter(call => call[2]?.action === 'merge').map(call => call[2])
  assert.equal(imports.length, 3)
  assert.equal(imports[0].reconciliationId, imports[1].reconciliationId)
  assert.notEqual(imports[1].reconciliationId, imports[2].reconciliationId)
  assert.deepEqual(imports[2].courseIds, [f.courseId('second-content')])
})

test('a stale legacy tab cannot re-import deleted account data, while new signed-out keys still merge', async () => {
  const f = fixture({ a: [], b: [] })
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['first-slug']))
  f.signIn('a')
  await f.store.refresh()
  assert.equal(await f.store.remove(catalog[0]), true)
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['first-slug']))
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot().keys, [], 'old tabs cannot resurrect a deleted bookmark')
  f.signIn(null)
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot().keys, [], 'stale account data is hidden from signed-out views')
  assert.equal(await f.store.toggle(catalog[1]), 'added')
  f.signIn('b')
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot().keys, ['second-content'])
  assert.deepEqual([...f.accounts.get('a')], [])
})

test('a consumed fallback marker never blocks a later genuine signed-out bookmark', async () => {
  const f = fixture({ a: [] })
  const remove = f.storage.removeItem.bind(f.storage)
  let failPendingRemoval = true
  f.storage.removeItem = key => {
    if (key.startsWith('ci_bookmarks_v1_pending:') && failPendingRemoval) {
      failPendingRemoval = false
      throw new Error('temporary storage failure')
    }
    remove(key)
  }
  f.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(['first-slug']))
  f.signIn('a')
  await f.store.refresh()
  assert.equal(f.store.getSnapshot().mode, 'account')
  assert.match(f.storage.getItem(`ci_bookmarks_v1_pending:${marker.a}`), /"consumed":true/)
  assert.equal(await f.store.remove(catalog[0]), true)
  f.signIn(null)
  await f.store.refresh()
  assert.equal(await f.store.toggle(catalog[1]), 'added')
  f.signIn('a')
  await f.store.refresh()
  assert.deepEqual(f.store.getSnapshot().keys, ['second-content'])
})

test('failed account writes keep the displayed server state unchanged', async () => {
  const f = fixture({ a: ['first-content'] })
  f.signIn('a')
  await f.store.refresh()
  f.failWrite(true)
  assert.equal(await f.store.toggle(catalog[1]), null)
  assert.deepEqual(f.store.getSnapshot().keys, ['first-content'])
  assert.equal(await f.store.remove(catalog[0]), false)
  assert.deepEqual(f.store.getSnapshot().keys, ['first-content'])
})

test('rapid duplicate-button toggles serialize and preserve the final selection', async () => {
  const f = fixture({ a: [] })
  f.signIn('a')
  await f.store.refresh()
  let release
  const original = f.transport.write
  let first = true
  f.transport.write = async (...args) => {
    if (first) { first = false; await new Promise(resolve => { release = resolve }) }
    return original(...args)
  }
  const added = f.store.toggle(catalog[0])
  const removed = f.store.toggle(catalog[0])
  await Promise.resolve()
  release()
  assert.equal(await added, 'added')
  assert.equal(await removed, 'removed')
  assert.deepEqual(f.store.getSnapshot().keys, [])
  assert.deepEqual(f.calls.filter(call => call[0] === 'write').map(call => call[2].action), ['add', 'remove'])
})

test('late account responses cannot replace the state after an account switch', async () => {
  const storage = new MemoryStorage()
  const resolvers = []
  const transport = { read: () => new Promise(resolve => { resolvers.push(resolve) }),
    verify: async () => 'same',
    write: async () => { throw new Error('unexpected write') } }
  const store = new BookmarkStore(() => storage, transport)
  store.configure(catalog)
  const first = store.refresh()
  const second = store.refresh()
  resolvers[1]({ status: 'ready', courseKeys: ['second-content'],
    continuityToken: 'token-b', ownerMarker: marker.b, courseIds: [] })
  await second
  resolvers[0]({ status: 'ready', courseKeys: ['first-content'],
    continuityToken: 'token-a', ownerMarker: marker.a, courseIds: [] })
  await first
  assert.deepEqual(store.getSnapshot().keys, ['second-content'])
})

test('a returned old-account set is rejected when the live session has already switched', async () => {
  const storage = new MemoryStorage()
  let reads = 0
  const transport = {
    async read() {
      reads++
      return reads === 1
        ? { status: 'ready', courseKeys: ['first-content'], continuityToken: 'token-a',
          ownerMarker: marker.a, courseIds: [] }
        : { status: 'ready', courseKeys: ['second-content'], continuityToken: 'token-b',
          ownerMarker: marker.b, courseIds: [] }
    },
    async verify(token) { return token === 'token-b' ? 'same' : 'changed' },
    async write() { throw new Error('unexpected write') },
  }
  const store = new BookmarkStore(() => storage, transport)
  store.configure(catalog)
  await store.refresh()
  assert.equal(reads, 2)
  assert.deepEqual(store.getSnapshot(), { mode: 'account', keys: ['second-content'] })
})
