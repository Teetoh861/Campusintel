// Isolated D02 reproduction. Run manually with Node 22 and local Supabase running.
// No migrations or policy changes. Creates and deletes one disposable local user.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { createClient } = require('@supabase/supabase-js')

let step = 'read local status'
async function main() {
  const status = JSON.parse(execFileSync('supabase', ['status', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  const base = new URL(status.API_URL)
  assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Diagnostic must use local Supabase')
  const admin = createClient(base.href, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const publicKey = status.ANON_KEY
  const sql = query => execFileSync('docker', ['exec', 'supabase_db_Campusintel', 'psql',
    '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let userId
  try {
    const password = randomBytes(32).toString('base64url') + 'aA1!'
    const email = `d02-${randomBytes(12).toString('hex')}@example.test`
    step = 'create local fixture'
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    assert.equal(created.error, null, 'Local fixture creation failed')
    userId = created.data.user.id
    assert.match(userId, /^[a-f0-9-]{36}$/)
    const auth = createClient(base.href, publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
    step = 'sign in local fixture'
    const signed = await auth.auth.signInWithPassword({ email, password })
    assert.equal(signed.error, null, 'Local sign-in failed')
    const token = signed.data.session.access_token
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'))
    const sessionCount = () => Number(sql(`select count(*) from auth.sessions where user_id = '${userId}'`))
    step = 'verify local auth session'
    assert.equal(sessionCount(), 1, 'Fixture must have a live session')
    const reference = async table => {
      const result = await auth.from(table).select('id').eq('is_active', true).order('sort_order').limit(2)
      if (result.error) throw new Error(`Reference ${table}: ${result.error.code}`)
      assert.ok(result.data.length)
      return result.data.map(row => row.id)
    }
    step = 'read reference data'
    const [departments, levels, periods] = await Promise.all([
      reference('departments'), reference('academic_levels'), reference('academic_periods'),
    ])
    const courses = await auth.from('courses').select('id').limit(1)
    assert.equal(courses.error, null)
    const courseId = courses.data[0].id
    const request = async (path, method = 'GET', body) => {
      const response = await fetch(new URL(path, base), { method,
        headers: { apikey: publicKey, Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json', Prefer: 'return=representation' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const text = await response.text()
      const data = text ? JSON.parse(text) : null
      return { http: response.status, rows: Array.isArray(data) ? data.length : null,
        code: !Array.isArray(data) ? data?.code : undefined }
    }
    const profile = `/rest/v1/profiles?id=eq.${userId}&select=id,academic_level_id`
    const bookmarks = `/rest/v1/student_bookmarks?user_id=eq.${userId}&select=course_id`
    const selection = { department_id: departments[0], academic_level_id: levels[0], academic_period_id: periods[0] }
    step = 'baseline profile write'
    assert.equal((await request(profile, 'PATCH', selection)).rows, 1)
    step = 'baseline bookmark write'
    assert.equal((await request('/rest/v1/student_bookmarks', 'POST', { user_id: userId, course_id: courseId })).rows, 1)
    const before = { profileRead: await request(profile), bookmarkRead: await request(bookmarks) }
    step = 'revoke local session'
    const revoked = await admin.auth.admin.signOut(token, 'global')
    assert.equal(revoked.error, null, 'Local session revocation failed')
    assert.equal(sessionCount(), 0, 'Revocation must remove auth.sessions before testing retained JWT')
    assert.ok(claims.exp * 1000 > Date.now(), 'JWT must remain unexpired')
    step = 'retained JWT requests'
    const after = {
      authUser: await request('/auth/v1/user'),
      profileRead: await request(profile),
      profileWrite: await request(profile, 'PATCH', { ...selection, academic_level_id: levels.at(-1) }),
      bookmarkRead: await request(bookmarks),
      bookmarkDelete: await request(bookmarks, 'DELETE'),
      bookmarkInsert: await request('/rest/v1/student_bookmarks', 'POST', { user_id: userId, course_id: courseId }),
    }
    console.log(JSON.stringify({ localOnly: true, revokedSessionRows: sessionCount(),
      jwtSecondsUntilExpiry: claims.exp - Math.floor(Date.now() / 1000), before, after,
      paths: ['GET /auth/v1/user', 'GET/PATCH /rest/v1/profiles?id=eq.<fixture-user>&select=id,academic_level_id',
        'GET/DELETE /rest/v1/student_bookmarks?user_id=eq.<fixture-user>&select=course_id',
        'POST /rest/v1/student_bookmarks'],
      reproduced: after.profileRead.rows === 1 && after.profileWrite.rows === 1 &&
        after.bookmarkRead.rows === 1 && after.bookmarkDelete.rows === 1 && after.bookmarkInsert.rows === 1,
    }, null, 2))
  } finally {
    if (userId) {
      const result = await admin.auth.admin.deleteUser(userId)
      assert.equal(result.error, null, 'Local diagnostic account cleanup failed')
    }
  }
}

main().catch(error => { console.error(`Local D02 diagnostic failed at ${step} (${error.code || error.name}${error.message?.startsWith('Reference ') ? ': ' + error.message : ''}); no credentials were logged.`); process.exitCode = 1 })
