// lib/ai-practice/cleanup.test.cjs — Retention sweep ordering, failure handling and account-deletion removal.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isAuthorizedCleanupRequest, removeAiPracticeUploadsForUser, runAiPracticeCleanup } = require('./cleanup.ts')

const USER = '21111111-1111-4111-8111-111111111111'
const purgeReport = { deleted_sets: 2, deleted_documents: 1, expired_upload_slots: 0, retained_documents: 0,
  outstanding_uploads: 0, purge_blocking_uploads: 0 }

function fakeClient({ pages = [], removeError = null, purge = purgeReport, listed = [] } = {}) {
  const log = []
  return { log, rpc: async (name, args) => {
    log.push(['rpc', name, args])
    if (name === 'list_ai_practice_uploads_to_remove') return { data: pages.shift() ?? [], error: null }
    return { data: purge, error: null }
  }, storage: { from: bucket => ({
    remove: async paths => { log.push(['remove', bucket, paths.length]); return { data: [], error: removeError } },
    list: async (prefix, options) => { log.push(['list', prefix, options.limit]); return { data: listed.shift() ?? [], error: null } },
  }) } }
}

test('objects are removed before rows are purged', async () => {
  const client = fakeClient({ pages: [Array.from({ length: 100 }, (_, i) => `${USER}/${i}`), [`${USER}/x`]] })
  const report = await runAiPracticeCleanup(client)
  assert.deepEqual(report, { ok: true, complete: true, removedUploads: 101, purge: purgeReport })
  assert.deepEqual(client.log.map(entry => entry.slice(0, 2)), [['rpc', 'list_ai_practice_uploads_to_remove'],
    ['remove', 'ai-practice-uploads'], ['rpc', 'list_ai_practice_uploads_to_remove'], ['remove', 'ai-practice-uploads'],
    ['rpc', 'purge_expired_ai_practice']])
})

test('a run that hits its batch limit says so instead of claiming completion', async () => {
  const full = () => Array.from({ length: 100 }, (_, i) => `${USER}/${i}`)
  // The database still holds files after 20 full batches, so it keeps their expired rows and reports them.
  const outstanding = { ...purgeReport, deleted_documents: 0, retained_documents: 7, outstanding_uploads: 350,
    purge_blocking_uploads: 3 }
  const client = fakeClient({ pages: Array.from({ length: 25 }, full), purge: outstanding })
  const report = await runAiPracticeCleanup(client)
  assert.deepEqual(report, { ok: true, complete: false, removedUploads: 2000, purge: outstanding })
  assert.equal(client.log.filter(entry => entry[0] === 'remove').length, 20, 'bounded to 20 batches per run')
  assert.equal(client.log.at(-1)[1], 'purge_expired_ai_practice', 'the safe purge still runs')
})

test('a Storage failure stops before any row is purged', async () => {
  const client = fakeClient({ pages: [['a/b']], removeError: new Error('down') })
  assert.deepEqual(await runAiPracticeCleanup(client), { ok: false, complete: false, removedUploads: 0, purge: null })
  assert.ok(!client.log.some(entry => entry[1] === 'purge_expired_ai_practice'))
})

test('a malformed or older-shaped purge reply is reported as a failed run', async () => {
  assert.equal((await runAiPracticeCleanup(fakeClient({ purge: { deleted_sets: 'x' } }))).ok, false)
  const { retained_documents: _, ...withoutRetention } = purgeReport
  assert.equal((await runAiPracticeCleanup(fakeClient({ purge: withoutRetention }))).ok, false)
})

test('account deletion helper empties only that student folder', async () => {
  const client = fakeClient({ listed: [[{ name: 'doc-1' }, { name: 'doc-2' }], []] })
  assert.equal(await removeAiPracticeUploadsForUser(client, USER), true)
  assert.deepEqual(client.log, [['list', USER, 100], ['remove', 'ai-practice-uploads', 2], ['list', USER, 100]])
  assert.equal(await removeAiPracticeUploadsForUser(fakeClient(), '../other'), false)
})

test('the cleanup route requires the long bearer secret, compared in constant time', () => {
  const secret = 's'.repeat(40)
  assert.equal(isAuthorizedCleanupRequest(`Bearer ${secret}`, secret), true)
  assert.equal(isAuthorizedCleanupRequest(`Bearer ${secret}x`, secret), false)
  assert.equal(isAuthorizedCleanupRequest(secret, secret), false)
  assert.equal(isAuthorizedCleanupRequest(null, secret), false)
  assert.equal(isAuthorizedCleanupRequest('Bearer short', 'short'), false, 'a weak secret disables the route')
  assert.equal(isAuthorizedCleanupRequest('Bearer ', undefined), false)
})
