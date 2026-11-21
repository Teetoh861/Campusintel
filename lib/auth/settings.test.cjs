// Runs in plain Node too: the shared rules have no Next.js, alias or test-loader dependency.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AUTH_INTERNAL_SECRET_MIN_BYTES, AuthSettingsError, readSupabaseConfig,
  readAuthSecretKey, readAuthInternalSecret, readAuthOrigin } = require('./settings.cjs')

// Synthetic structure only: no valid signature or usable credential.
const LOCAL_JWT = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
  Buffer.from('{"role":"service_role","iss":"test-fixture"}').toString('base64url'), Buffer.alloc(32).toString('base64url')].join('.')
const valid = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.example.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-fixture',
  SUPABASE_SECRET_KEY: 'sb_secret_fixture', AUTH_INTERNAL_SECRET: 'x'.repeat(32), NEXT_PUBLIC_SITE_URL: 'https://campus.example.test',
  NODE_ENV: 'production' }

test('public project settings preserve their existing URL and unpadded-key rules', () => {
  for (const url of ['https://project.example.test', 'http://project.example.test', 'http://localhost:54321',
    ' https://project.example.test ', 'https://PROJECT.example.test:443/']) {
    for (const key of ['public-fixture', 'not-a-prefixed-key', 'sb_publishable_fixture']) {
      assert.deepEqual(readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }), { url, key })
    }
  }
  for (const url of [undefined, '', 'invalid', 'ftp://project.example.test', 'https://user:password@project.example.test',
    'https://project.example.test/path', 'https://project.example.test?x=1', 'https://project.example.test#fragment']) {
    assert.throws(() => readSupabaseConfig({ ...valid, NEXT_PUBLIC_SUPABASE_URL: url }), AuthSettingsError)
  }
  for (const key of [undefined, '', ' ', ' padded', 'padded ', 'padded\n']) {
    assert.throws(() => readSupabaseConfig({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }), AuthSettingsError)
  }
})

test('privileged keys preserve production-only format checks and the loopback JWT exception', () => {
  for (const mode of [undefined, 'development', 'test', 'Production']) {
    assert.equal(readAuthSecretKey({ NODE_ENV: mode, SUPABASE_SECRET_KEY: 'opaque-fixture' }), 'opaque-fixture')
  }
  assert.equal(readAuthSecretKey(valid), valid.SUPABASE_SECRET_KEY)
  for (const key of [undefined, '', ' ', 'opaque-fixture', 'sb_secret_', 'sb_secret_x ', LOCAL_JWT]) {
    assert.throws(() => readAuthSecretKey({ ...valid, SUPABASE_SECRET_KEY: key }), AuthSettingsError)
  }
  for (const url of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) {
    assert.equal(readAuthSecretKey({ ...valid, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: LOCAL_JWT }), LOCAL_JWT)
  }
  for (const url of ['http://localhost.attacker.test', 'http://localhost@attacker.test', 'ftp://localhost', 'invalid', '']) {
    assert.throws(() => readAuthSecretKey({ ...valid, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: LOCAL_JWT }), AuthSettingsError)
  }
  // Keep the key reader's scope: the public-project reader independently rejects this URL's path/credentials.
  assert.equal(readAuthSecretKey({ ...valid, NEXT_PUBLIC_SUPABASE_URL: 'https://user:password@project.example.test/path' }), valid.SUPABASE_SECRET_KEY)
  assert.throws(() => readAuthSecretKey({ ...valid, NEXT_PUBLIC_SUPABASE_URL: 'invalid' }), AuthSettingsError)
})

test('the internal secret keeps its exact UTF-8 byte minimum with no extra trimming rule', () => {
  assert.equal(AUTH_INTERNAL_SECRET_MIN_BYTES, 32)
  for (const secret of [undefined, '', 'x'.repeat(31), 'é'.repeat(15)]) {
    assert.throws(() => readAuthInternalSecret({ AUTH_INTERNAL_SECRET: secret }), AuthSettingsError)
  }
  for (const secret of ['x'.repeat(32), 'é'.repeat(16), ' '.repeat(32)]) {
    assert.equal(readAuthInternalSecret({ AUTH_INTERNAL_SECRET: secret }), secret)
  }
})

test('canonical site origins preserve HTTPS, loopback HTTP and origin normalization', () => {
  for (const [url, origin] of [['https://CAMPUS.example.test:443/', 'https://campus.example.test'],
    ['http://localhost:3000', 'http://localhost:3000'], ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
    ['http://[::1]:3000', 'http://[::1]:3000']]) {
    assert.equal(readAuthOrigin({ NEXT_PUBLIC_SITE_URL: url }), origin)
  }
  for (const url of [undefined, '', 'invalid', 'http://campus.example.test', 'ftp://localhost',
    'https://user:password@campus.example.test', 'https://campus.example.test/path',
    'https://campus.example.test?x=1', 'https://campus.example.test#fragment']) {
    assert.throws(() => readAuthOrigin({ NEXT_PUBLIC_SITE_URL: url }), AuthSettingsError)
  }
})

test('runtime callers can preserve their existing error class and safe message', () => {
  const failure = new Error('safe runtime message')
  for (const read of [readSupabaseConfig, readAuthSecretKey, readAuthInternalSecret, readAuthOrigin]) {
    assert.throws(() => read({}, () => failure), error => error === failure)
  }
})
