// scripts/ai-practice/storage-integration.cjs — End-to-end check against a LOCAL Supabase stack with Storage.
// Exercises the real bucket limits, Storage RLS, signed uploads, direct-call abuse, extraction claims, accounting,
// cleanup, and the Account deletion worker with AI objects present. Refuses non-local URLs; never calls an AI provider.
// Needs the Account migrations (20261016100000-130000) applied before the AI migration.
//   AI_IT_URL=http://127.0.0.1:54321 AI_IT_PUBLISHABLE_KEY=... AI_IT_SECRET_KEY=... \
//   AI_IT_DB_CONTAINER=supabase_db_<project> node -r ./lib/auth/test-loader.cjs scripts/ai-practice/storage-integration.cjs
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { createClient } = require('@supabase/supabase-js')
const { strToU8, zipSync } = require('fflate')
const { extractUploadText } = require('../../lib/ai-practice/extract.ts')
const { prepareSource } = require('../../lib/ai-practice/source.ts')
const { removeAiPracticeUploadsForUser, runAiPracticeCleanup } = require('../../lib/ai-practice/cleanup.ts')
const { fixtureText } = require('../../lib/ai-practice/fixtures/fixture-provider.cjs')
const { run: runWorker } = require('../account-deletion/worker.cjs')

const url = process.env.AI_IT_URL
const publishable = process.env.AI_IT_PUBLISHABLE_KEY
const secret = process.env.AI_IT_SECRET_KEY
const container = process.env.AI_IT_DB_CONTAINER
if (!url || !publishable || !secret || !container || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  process.stderr.write('storage-integration: set AI_IT_URL (local only), AI_IT_PUBLISHABLE_KEY, AI_IT_SECRET_KEY and AI_IT_DB_CONTAINER\n')
  process.exit(2)
}
const BUCKET = 'ai-practice-uploads'
const PRODUCTION_SOURCES = ['trial', 'early_access']
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, secret, options)
const results = []
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]) } catch (error) { results.push(['FAIL', name, error.message]) }
}

/** Local database access for steps no API role may take: scheduling a deletion and forcing its deadline. */
function sql(statement) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq',
    '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr.trim())
  return result.stdout.trim()
}

/** A genuine minimal WordprocessingML package: content types, package relationships and one namespaced
 * w:document/w:body root, one paragraph per line. The hardened parser rejects anything less, and it must. */
function validDocx(text) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const paragraphs = text.split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`)
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document xmlns:w="${W}"><w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`),
  })
}

/** The grant verify_trial_otp() creates. Production trial AI exists only as an entitlement grant
 * (20261017100000_trial_entitlements.sql); it can no longer be issued directly. */
function issueTrial(userId) {
  sql(`insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units, created_by)
    values ('${userId}', 'trial', now(), now() + interval '7 days', 'capped', 10, 'storage-integration')`)
}

async function student(label) {
  const email = `ai-it-${label}-${randomUUID()}@example.test`
  const password = randomUUID()
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  const client = createClient(url, publishable, options)
  const signed = await client.auth.signInWithPassword({ email, password })
  if (signed.error) throw signed.error
  // The server route reads the same claim from the verified session.
  const claims = JSON.parse(Buffer.from(signed.data.session.access_token.split('.')[1], 'base64url').toString('utf8'))
  return { id: created.data.user.id, sessionId: claims.session_id, client }
}

const rpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.code ?? ''} ${error.message}`)
  return data
}
const reserve = (who, courseId, fileName, mediaType, bytes) => rpc(admin, 'create_ai_practice_document', {
  p_session_id: who.sessionId, p_institutional_course_id: courseId, p_file_name: fileName, p_media_type: mediaType,
  p_declared_bytes: bytes, p_accepted_sources: PRODUCTION_SOURCES })
const claim = (who, documentId) => rpc(admin, 'claim_ai_practice_extraction',
  { p_session_id: who.sessionId, p_document_id: documentId })

/** Upload exactly as the browser does: a raw PUT of the file to the signed URL. */
async function signUpload(who, path) {
  const signed = await who.client.storage.from(BUCKET).createSignedUploadUrl(path)
  return signed.error ? { signError: signed.error.message } : { url: signed.data.signedUrl }
}
async function put(signedUrl, body, contentType) {
  const response = await fetch(signedUrl, { method: 'PUT', body, headers: { 'Content-Type': contentType, 'x-upsert': 'false' } })
  return { status: response.status }
}
async function browserPut(who, path, body, contentType) {
  const signed = await signUpload(who, path)
  return signed.signError ? signed : put(signed.url, body, contentType)
}
const folder = async userId => (await admin.storage.from(BUCKET).list(userId)).data ?? []

async function main() {
  const a = await student('a')
  const b = await student('b')
  // The catalogue is readable by signed-in students, exactly as the read model reads it.
  const course = await a.client.from('institutional_courses').select('id').limit(1).single()
  if (course.error) throw course.error
  const courseId = course.data.id
  const docx = validDocx(fixtureText('marketing-mix-notes.txt'))
  let doc

  await check('a student holding their own JWT cannot reserve, claim, settle, account or grant directly', async () => {
    const attempts = {
      create_ai_practice_document: { p_session_id: a.sessionId, p_institutional_course_id: courseId, p_file_name: 'x.txt',
        p_media_type: 'text/plain', p_declared_bytes: 1, p_accepted_sources: ['trial', 'early_access', 'test'] },
      claim_ai_practice_extraction: { p_session_id: a.sessionId, p_document_id: randomUUID() },
      settle_ai_practice_document: { p_session_id: a.sessionId, p_document_id: randomUUID(), p_claim_id: randomUUID(),
        p_rejection_reason: null, p_source_text: 'fabricated', p_source_sha256: 'a'.repeat(64), p_word_count: 1 },
      release_ai_practice_extraction: { p_user_id: a.id, p_document_id: randomUUID(), p_claim_id: randomUUID() },
      note_ai_practice_upload_removed: { p_user_id: a.id, p_document_id: randomUUID() },
      begin_ai_practice_generation: { p_session_id: a.sessionId, p_request_id: randomUUID(), p_document_id: randomUUID(),
        p_accepted_sources: ['test'] },
      finish_ai_practice_generation: { p_user_id: a.id, p_generation_id: randomUUID(), p_status: 'failed',
        p_outcome_reason: null, p_question_set: null, p_usage: null },
      issue_ai_allowance_grant: { p_user_id: a.id, p_source: 'trial' },
      purge_expired_ai_practice: {},
    }
    for (const [name, args] of Object.entries(attempts)) {
      const { error } = await a.client.rpc(name, args)
      assert.ok(error, `${name} must be refused`)
    }
    const insert = await a.client.from('ai_practice_documents').insert({ id: randomUUID(), user_id: a.id })
    assert.ok(insert.error, 'no direct row insert')
  })
  await check('without a server-issued grant no upload slot is reserved', async () => {
    assert.equal((await reserve(a, courseId, 'week-3.docx', DOCX, docx.length)).status, 'not-entitled')
    assert.equal((await rpc(a.client, 'get_my_ai_allowance')).state, 'not-entitled')
  })
  await check('with a grant, the server reserves a slot at a session-derived path', async () => {
    issueTrial(a.id)
    doc = await reserve(a, courseId, 'week-3.docx', DOCX, docx.length)
    assert.equal(doc.status, 'created')
    assert.equal(doc.storage_path, `${a.id}/${doc.document_id}`)
  })
  await check('browser-style signed PUT stores the reserved file', async () => {
    assert.equal((await browserPut(a, doc.storage_path, docx, DOCX)).status, 200)
  })
  await check('the same path cannot be overwritten', async () => {
    const again = await browserPut(a, doc.storage_path, docx, DOCX)
    assert.ok(again.signError || again.status >= 400, JSON.stringify(again))
  })
  await check('Storage refuses a file over 5 MB', async () => {
    const big = await reserve(a, courseId, 'big.txt', 'text/plain', 5 * 1024 * 1024)
    const result = await browserPut(a, big.storage_path, new Uint8Array(5 * 1024 * 1024 + 1).fill(65), 'text/plain')
    assert.ok(result.status === 413 || result.status === 400, `status ${result.status}`)
  })
  await check('Storage refuses a disallowed media type', async () => {
    const odd = await reserve(a, courseId, 'odd.txt', 'text/plain', 10)
    const result = await browserPut(a, odd.storage_path, strToU8('<html>'), 'text/html')
    assert.ok(result.status >= 400, `status ${result.status}`)
  })
  await check('an unreserved path in the student folder cannot be signed or written', async () => {
    const result = await browserPut(a, `${a.id}/${randomUUID()}`, strToU8('x'), 'text/plain')
    assert.ok(result.signError || result.status >= 400, JSON.stringify(result))
  })
  await check('another student cannot read, sign, delete, claim or settle the upload', async () => {
    const read = await b.client.storage.from(BUCKET).download(doc.storage_path)
    assert.ok(read.error, 'download must fail')
    assert.ok((await signUpload(b, doc.storage_path)).signError, 'sign must fail')
    await b.client.storage.from(BUCKET).remove([doc.storage_path])
    assert.ok(!(await a.client.storage.from(BUCKET).download(doc.storage_path)).error, 'file still present')
    assert.deepEqual((await b.client.from('ai_practice_documents').select('id').eq('id', doc.document_id)).data, [])
    assert.equal((await claim(b, doc.document_id)).state, 'not-found')
  })
  await check('eight concurrent claims over HTTP produce exactly one extraction lease', async () => {
    const states = (await Promise.all(Array.from({ length: 8 }, () => claim(a, doc.document_id)))).map(row => row.state)
    assert.equal(states.filter(state => state === 'claimed').length, 1, JSON.stringify(states))
    assert.equal(states.filter(state => state === 'busy').length, 7, JSON.stringify(states))
    sql(`update public.ai_practice_documents set extraction_claim = null, extraction_claimed_until = null
      where id = '${doc.document_id}'`)
  })
  await check('the claim holder downloads, extracts, settles and removes the raw file', async () => {
    const held = await claim(a, doc.document_id)
    assert.equal(held.state, 'claimed')
    assert.ok((await signUpload(a, doc.storage_path)).signError, 'a claimed slot can no longer be signed')
    const downloaded = await a.client.storage.from(BUCKET).download(doc.storage_path)
    assert.ok(!downloaded.error)
    const extracted = await extractUploadText(new Uint8Array(await downloaded.data.arrayBuffer()), DOCX)
    assert.equal(extracted.status, 'ok')
    const prepared = prepareSource(extracted.text)
    assert.equal(prepared.status, 'ok')
    const settle = { p_session_id: a.sessionId, p_document_id: doc.document_id, p_rejection_reason: null,
      p_source_text: prepared.source.text, p_source_sha256: prepared.source.sha256, p_word_count: prepared.source.wordCount }
    assert.equal(await rpc(admin, 'settle_ai_practice_document', { ...settle, p_claim_id: randomUUID() }), false,
      'a caller without the claim cannot settle')
    assert.equal(await rpc(admin, 'settle_ai_practice_document', { ...settle, p_claim_id: held.claim_id }), true)
    const removed = await a.client.storage.from(BUCKET).remove([doc.storage_path])
    assert.ok(!removed.error && removed.data.length === 1)
    assert.equal(await rpc(admin, 'note_ai_practice_upload_removed', { p_user_id: a.id, p_document_id: doc.document_id }), true)
  })
  await check('service-role accounting: failure releases, success consumes, a replay is not charged', async () => {
    const start = requestId => rpc(admin, 'begin_ai_practice_generation', { p_session_id: a.sessionId,
      p_request_id: requestId, p_document_id: doc.document_id, p_accepted_sources: PRODUCTION_SOURCES })
    const first = await start(randomUUID())
    assert.equal(first.state, 'started')
    await rpc(admin, 'finish_ai_practice_generation', { p_user_id: a.id, p_generation_id: first.generation_id,
      p_status: 'failed', p_outcome_reason: 'timeout', p_question_set: null, p_usage: null })
    assert.equal((await rpc(a.client, 'get_my_ai_allowance')).used, 0)
    const requestId = randomUUID()
    const second = await start(requestId)
    await rpc(admin, 'finish_ai_practice_generation', { p_user_id: a.id, p_generation_id: second.generation_id,
      p_status: 'generated', p_outcome_reason: null, p_question_set: { formatVersion: 1, origin: 'ai-generated',
        visibility: 'personal', verification: 'unverified', source: { fileName: 'week-3.docx' }, questions: [{}] },
      p_usage: { provider: 'anthropic', model: 'claude-sonnet-5-5', inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.00001 } })
    // The browser lost the reply and retries with the same id.
    const replay = await start(requestId)
    assert.deepEqual([replay.state, replay.generation_id], ['existing', second.generation_id])
    assert.equal((await rpc(a.client, 'get_my_ai_allowance')).used, 1)
    assert.equal((await a.client.from('ai_practice_generations').select('status').eq('status', 'generated')).data.length, 1)
    assert.equal((await b.client.from('ai_practice_generations').select('id')).data.length, 0)
  })
  await check('cleanup removes unreserved leftovers and keeps fresh slots', async () => {
    const fresh = await reserve(a, courseId, 'fresh.txt', 'text/plain', 4)
    assert.equal((await browserPut(a, fresh.storage_path, strToU8('fresh'), 'text/plain')).status, 200)
    const report = await runAiPracticeCleanup(admin)
    assert.equal(report.ok, true, JSON.stringify(report))
    assert.equal(report.complete, true, JSON.stringify(report))
    assert.ok(!(await a.client.storage.from(BUCKET).download(fresh.storage_path)).error, 'awaiting upload kept')
  })

  // Account lifecycle, driven through the real Account deletion worker (scripts/account-deletion/worker.cjs).
  const c = await student('c')
  issueTrial(c.id)
  const workerEnv = { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, ACCOUNT_DELETION_WORKER_ENABLED: 'true' }
  let ready
  await check('a student with AI files schedules deletion; an already-signed URL still uploads afterwards', async () => {
    ready = await reserve(c, courseId, 'kept.txt', 'text/plain', 4)
    assert.equal((await browserPut(c, ready.storage_path, strToU8('kept'), 'text/plain')).status, 200)
    const pending = await reserve(c, courseId, 'late.txt', 'text/plain', 4)
    const lateSigned = await signUpload(c, pending.storage_path)
    assert.ok(lateSigned.url, lateSigned.signError)
    const orphan = await reserve(c, courseId, 'orphan.txt', 'text/plain', 6)
    assert.equal((await browserPut(c, orphan.storage_path, strToU8('orphan'), 'text/plain')).status, 200)
    // The row is gone but the file remains: an account-owned orphan.
    sql(`delete from public.ai_practice_documents where id = '${orphan.document_id}'`)
    // Schedule exactly as public.schedule_student_deletion records it: a job, and every session revoked.
    sql(`insert into private.account_deletion_jobs (user_id, requested_at, deadline, retry_at)
      values ('${c.id}', now(), now() + interval '720 hours', now() + interval '720 hours');
      delete from auth.sessions where user_id = '${c.id}';`)
    assert.equal((await reserve(c, courseId, 'more.txt', 'text/plain', 4)).status, 'signed-out')
    assert.equal((await rpc(admin, 'begin_ai_practice_generation', { p_session_id: c.sessionId, p_request_id: randomUUID(),
      p_document_id: ready.document_id, p_accepted_sources: PRODUCTION_SOURCES })).state, 'signed-out',
      'a scheduled account cannot generate')
    // Storage checks policy when a URL is signed, not when the file arrives.
    assert.equal((await put(lateSigned.url, strToU8('late'), 'text/plain')).status, 200)
    assert.equal((await folder(c.id)).length, 3)
  })
  await check('a Storage cleanup failure blocks the unsafe purge (P0002) and is reported as a worker failure', async () => {
    sql(`update private.account_deletion_jobs set requested_at = now() - interval '721 hours',
      deadline = now() - interval '1 hour', retry_at = now() - interval '1 second' where user_id = '${c.id}'`)
    assert.equal((await rpc(admin, 'begin_ai_practice_generation', { p_session_id: c.sessionId, p_request_id: randomUUID(),
      p_document_id: ready.document_id, p_accepted_sources: PRODUCTION_SOURCES })).state, 'signed-out',
      'an account past its deadline cannot generate')
    const storageDown = async (target, init) => target.pathname.startsWith('/storage/')
      ? new Response('{}', { status: 503 }) : fetch(target, init)
    const { data, exitCode } = await runWorker(['--run'], workerEnv, storageDown)
    assert.deepEqual(data.aiStorage, { ok: false, removed: null, remaining: null })
    assert.equal(data.failedThisRun, 1, JSON.stringify(data))
    assert.equal(exitCode, 1, 'operations monitoring sees the failure')
    assert.equal(sql(`select last_error_code from private.account_deletion_jobs where user_id = '${c.id}'`), 'P0002')
    assert.equal(sql(`select count(*) from public.entitlement_grants where user_id = '${c.id}'`), '1', 'purge rolled back')
    assert.equal((await folder(c.id)).length, 3)
  })
  await check('on retry the worker removes the late file and orphan through Storage, then the purge completes', async () => {
    sql(`update private.account_deletion_jobs set retry_at = now() - interval '1 second' where user_id = '${c.id}'`)
    const { data, exitCode } = await runWorker(['--run'], workerEnv)
    assert.deepEqual(data.aiStorage, { ok: true, removed: 3, remaining: 0 })
    assert.equal(data.completed, 1, JSON.stringify(data))
    assert.equal(exitCode, 0)
    assert.ok(!JSON.stringify(data).includes(c.id), 'worker output carries no ids or paths')
    assert.deepEqual(await folder(c.id), [], 'no object of the purged account remains')
    assert.equal(sql(`select (select count(*) from public.ai_practice_documents where user_id = '${c.id}')
      + (select count(*) from public.ai_usage_events where user_id = '${c.id}')
      + (select count(*) from public.entitlement_grants where user_id = '${c.id}')
      + (select count(*) from auth.users where id = '${c.id}')`), '0')
    assert.ok((await folder(a.id)).length >= 1, 'another student\'s files are untouched')
    const again = await runWorker(['--run'], workerEnv)
    assert.deepEqual([again.data.aiStorage, again.exitCode], [{ ok: true, removed: 0, remaining: 0 }, 0], 'a repeat run is a no-op')
  })
  await check('the per-account helper empties a folder and is safe to repeat', async () => {
    assert.equal(await removeAiPracticeUploadsForUser(admin, a.id), true)
    assert.equal(await removeAiPracticeUploadsForUser(admin, a.id), true)
    const deleted = await admin.auth.admin.deleteUser(a.id)
    assert.ok(!deleted.error, deleted.error?.message)
    assert.deepEqual(await folder(a.id), [])
  })
  await admin.auth.admin.deleteUser(b.id)
}

main().catch(error => results.push(['FAIL', 'setup', error.message])).finally(() => {
  for (const [status, name, detail] of results) process.stdout.write(`${status}  ${name}${detail ? ` — ${detail}` : ''}\n`)
  process.exitCode = results.some(([status]) => status === 'FAIL') ? 1 : 0
})
