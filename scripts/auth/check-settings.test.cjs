const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const script = path.join(__dirname, 'check-settings.cjs')

// Fixtures only. Children inherit no real settings, credentials, NODE_OPTIONS or test loader.
const valid = { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', STUDENT_AUTH_ENABLED: 'true',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.example.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  SUPABASE_SECRET_KEY: 'sb_secret_fixture', AUTH_INTERNAL_SECRET: 'fixture_internal_material_at_least_32_bytes',
  NEXT_PUBLIC_SITE_URL: 'https://campus.example.test' }
const settings = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
  'AUTH_INTERNAL_SECRET', 'NEXT_PUBLIC_SITE_URL']

function run(env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined))
  const result = spawnSync(process.execPath, [script], { env: clean, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  return result
}

test('valid live and develop Preview settings pass in plain Node with one exact line', () => {
  for (const [environment, branch] of [['production', 'main'], ['production', 'release/live'], ['preview', 'develop']]) {
    const result = run({ ...valid, VERCEL_ENV: environment, VERCEL_GIT_COMMIT_REF: branch })
    assert.equal(result.status, 0)
    assert.equal(result.stdout, `CampusIntell sign-in settings: OK (${environment}, ${branch})\n`)
    assert.equal(result.stderr, '')
  }
})

test('each missing setting fails by name without exposing any configured value', () => {
  for (const environment of ['production', 'preview']) {
    const branch = environment === 'preview' ? 'develop' : 'main'
    for (const setting of settings) {
      for (const value of [undefined, '']) {
        const result = run({ ...valid, VERCEL_ENV: environment, VERCEL_GIT_COMMIT_REF: branch, [setting]: value })
        assert.equal(result.status, 1, setting)
        assert.equal(result.stdout, '')
        assert.equal(result.stderr, `CampusIntell sign-in settings: ${setting} missing (${environment}, ${branch})\n`)
      }
    }
  }
})

test('invalid settings fail by name and reason, never a value or fragment', () => {
  for (const [setting, value, reason] of [
    ['NEXT_PUBLIC_SUPABASE_URL', 'not-a-url_PRIVATE_MARKER', 'wrong format'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://PRIVATE_USER:PRIVATE_PASSWORD@project.example.test', 'wrong format'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://project.example.test/PRIVATE_PATH', 'wrong format'],
    ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ' PRIVATE_PUBLISHABLE ', 'wrong format'],
    ['SUPABASE_SECRET_KEY', 'PRIVATE_SECRET_INVALID', 'wrong format'],
    ['SUPABASE_SECRET_KEY', 'sb_secret_PRIVATE_PADDED ', 'wrong format'],
    ['AUTH_INTERNAL_SECRET', 'PRIVATE_SHORT', 'too short'],
    ['NEXT_PUBLIC_SITE_URL', 'http://PRIVATE_REMOTE.example.test', 'wrong format'],
    ['NEXT_PUBLIC_SITE_URL', 'https://PRIVATE_USER:PRIVATE_PASSWORD@campus.example.test', 'wrong format'],
    ['NEXT_PUBLIC_SITE_URL', 'https://campus.example.test/PRIVATE_PATH', 'wrong format'],
  ]) {
    const result = run({ ...valid, [setting]: value })
    assert.equal(result.status, 1, setting)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, `CampusIntell sign-in settings: ${setting} ${reason} (production, main)\n`)
    assert.doesNotMatch(result.stderr, /PRIVATE_|sb_secret_|sb_publishable_|project\.example|campus\.example/)
  }
})

test('all missing or invalid settings produce exactly one line per setting, including shared URL failures', () => {
  const absent = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'develop', STUDENT_AUTH_ENABLED: 'true' }
  const invalid = { ...valid, NEXT_PUBLIC_SUPABASE_URL: 'PRIVATE_INVALID_URL', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ' PRIVATE_KEY ',
    SUPABASE_SECRET_KEY: 'PRIVATE_SECRET', AUTH_INTERNAL_SECRET: 'PRIVATE_SHORT', NEXT_PUBLIC_SITE_URL: 'PRIVATE_INVALID_ORIGIN' }
  for (const env of [absent, invalid]) {
    const result = run(env), lines = result.stderr.trim().split('\n')
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(lines.length, settings.length)
    for (const setting of settings) assert.equal(lines.filter(line => line.includes(`: ${setting} `)).length, 1)
    assert.doesNotMatch(result.stderr, /PRIVATE_/)
  }
})

test('the check always uses production key rules before Next sets NODE_ENV', () => {
  for (const mode of [undefined, 'development', 'test', 'production']) {
    const result = run({ ...valid, NODE_ENV: mode, SUPABASE_SECRET_KEY: 'PRIVATE_OPAQUE_KEY' })
    assert.equal(result.status, 1)
    assert.equal(result.stderr, 'CampusIntell sign-in settings: SUPABASE_SECRET_KEY wrong format (production, main)\n')
  }
})

test('off, local, CI and unrelated previews skip with no required settings', () => {
  const enabledProduction = { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', STUDENT_AUTH_ENABLED: 'true' }
  const cases = [{}, { CI: 'true', STUDENT_AUTH_ENABLED: 'true' }]
  for (const flag of [undefined, '', 'false', 'TRUE', '1', 'true ']) cases.push({ ...enabledProduction, STUDENT_AUTH_ENABLED: flag })
  for (const flag of [undefined, '0', 'true', '1 ']) cases.push({ ...enabledProduction, VERCEL: flag })
  for (const branch of [undefined, 'feature/auth', 'Develop', 'develop ', 'refs/heads/develop']) {
    cases.push({ ...enabledProduction, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: branch })
  }
  for (const environment of [undefined, 'development', 'Production', 'production ', 'Preview']) {
    cases.push({ ...enabledProduction, VERCEL_ENV: environment, VERCEL_GIT_COMMIT_REF: 'develop' })
  }
  for (const env of cases) {
    const result = run(env)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /^CampusIntell sign-in settings: SKIPPED \([^\r\n]+\)\n$/)
    assert.equal(result.stderr, '')
  }
})

test('unusual branch metadata cannot turn a result into multiple lines', () => {
  const result = run({ ...valid, VERCEL_GIT_COMMIT_REF: 'main\nPRIVATE_METADATA', AUTH_INTERNAL_SECRET: undefined })
  assert.equal(result.status, 1)
  assert.equal(result.stderr, 'CampusIntell sign-in settings: AUTH_INTERNAL_SECRET missing (production, unknown)\n')
})

test('the package build checks settings before invoking Next', () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'))
  assert.match(scripts.build, /^node scripts\/auth\/check-settings\.cjs && /)
  assert.ok(scripts.build.indexOf('check-settings.cjs') < scripts.build.indexOf('next build'))
})
