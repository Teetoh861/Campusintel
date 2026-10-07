// lib/auth/preview-origin.test.ts — Exact deployment origins without widening production or CSRF trust.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAuthOrigin, isTrustedAuthOrigin } from './config'
import { readAuthRequest } from './request'
import { emailRequestSchema } from './schemas'

const CANONICAL = 'https://campusintel.test'
const DEPLOYMENT_HOST = 'preview-current.vercel.app'
const PREVIEW = 'https://preview-current.vercel.app'
const OTHER_PREVIEW = 'https://preview-other.vercel.app'

async function withEnvironment(overrides: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const values: Record<string, string | undefined> = {
    NODE_ENV: 'production', STUDENT_AUTH_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: CANONICAL,
    VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: DEPLOYMENT_HOST,
    VERCEL_BRANCH_URL: 'preview-other.vercel.app', ...overrides,
  }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function request(origin: string | null, headers: Record<string, string> = {}): Request {
  return new Request(PREVIEW + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin',
      ...(origin === null ? {} : { Origin: origin }), ...headers },
    body: JSON.stringify({ email: 'student@example.test' }),
  })
}

test('production accepts its exact canonical origin and rejects unrelated origins', async () => {
  await withEnvironment({}, async () => {
    assert.equal(getAuthOrigin(), CANONICAL)
    assert.deepEqual(await readAuthRequest(request(CANONICAL), emailRequestSchema), { email: 'student@example.test' })
    for (const origin of ['https://other.test', PREVIEW, OTHER_PREVIEW, 'https://attacker.vercel.app']) {
      assert.equal(isTrustedAuthOrigin(origin), false)
      await assert.rejects(readAuthRequest(request(origin), emailRequestSchema), { status: 403 })
    }
  })
})

test('Vercel Preview accepts only its exact additional deployment origin and retains canonical trust', async () => {
  await withEnvironment({ VERCEL_ENV: 'preview' }, async () => {
    for (const origin of [CANONICAL, PREVIEW]) {
      assert.deepEqual(await readAuthRequest(request(origin), emailRequestSchema), { email: 'student@example.test' })
    }
    assert.equal(getAuthOrigin(), CANONICAL, 'the canonical resolver remains unchanged')
  })
})

test('other Vercel domains, branch aliases and forged request host metadata cannot extend Preview trust', async () => {
  await withEnvironment({ VERCEL_ENV: 'preview' }, async () => {
    for (const origin of [OTHER_PREVIEW, 'https://attacker.vercel.app', 'https://preview-current.vercel.app.attacker.test']) {
      assert.equal(isTrustedAuthOrigin(origin), false)
      await assert.rejects(readAuthRequest(request(origin, {
        Host: 'attacker.vercel.app', 'X-Forwarded-Host': 'attacker.vercel.app',
        'X-Vercel-Url': 'attacker.vercel.app',
      }), emailRequestSchema), { status: 403 })
    }
  })
})

test('deployment trust requires the exact Vercel Preview platform flags', async () => {
  for (const env of [undefined, 'production', 'development', 'Preview', 'preview ']) {
    await withEnvironment({ VERCEL_ENV: env }, async () => {
      await assert.rejects(readAuthRequest(request(PREVIEW), emailRequestSchema), { status: 403 })
    })
  }
  for (const flag of [undefined, '0', 'true', '1 ']) {
    await withEnvironment({ VERCEL: flag, VERCEL_ENV: 'preview' }, async () => {
      await assert.rejects(readAuthRequest(request(PREVIEW), emailRequestSchema), { status: 403 })
    })
  }
})

test('missing and malformed deployment hostnames fail closed without changing canonical access', async () => {
  for (const hostname of [undefined, '', ' ', 'https://preview-current.vercel.app', '//preview-current.vercel.app',
    'preview-current.vercel.app/', 'preview-current.vercel.app:443', 'user@preview-current.vercel.app',
    'preview-current.vercel.app?x=1', 'preview-current.vercel.app#fragment', 'preview-current.vercel.app\\path',
    ' preview-current.vercel.app', 'preview-current.vercel.app\n', 'preview..vercel.app',
    '-preview.vercel.app', 'preview-.vercel.app', 'preview.vercel.app.', 'preview%2evercel.app',
    'prévìew.vercel.app', 'localhost', '127.0.0.1', '[::1]',
    'a'.repeat(64) + '.vercel.app', Array(5).fill('a'.repeat(60)).join('.')]) {
    await withEnvironment({ VERCEL_ENV: 'preview', VERCEL_URL: hostname }, async () => {
      assert.equal(isTrustedAuthOrigin(PREVIEW), false)
      await assert.rejects(readAuthRequest(request(PREVIEW), emailRequestSchema), { status: 403 })
      assert.deepEqual(await readAuthRequest(request(CANONICAL), emailRequestSchema), { email: 'student@example.test' })
    })
  }
})

test('Preview origin comparison is exact across scheme, port, path and credentials', async () => {
  await withEnvironment({ VERCEL_ENV: 'preview' }, async () => {
    for (const origin of [null, '', 'null', 'http://preview-current.vercel.app', PREVIEW + ':443',
      PREVIEW + ':8443', PREVIEW + '/', PREVIEW + '/path', PREVIEW + '?x=1', PREVIEW + '#fragment',
      'https://user@preview-current.vercel.app']) {
      await assert.rejects(readAuthRequest(request(origin), emailRequestSchema), { status: 403 })
    }
  })
})

test('Preview compatibility retains fetch-site CSRF rejection and strict JSON validation', async () => {
  await withEnvironment({ VERCEL_ENV: 'preview' }, async () => {
    for (const site of ['cross-site', 'same-site']) {
      await assert.rejects(readAuthRequest(request(PREVIEW, { 'Sec-Fetch-Site': site }), emailRequestSchema), { status: 403 })
    }
    await assert.rejects(readAuthRequest(request(PREVIEW, { 'Content-Type': 'text/plain' }), emailRequestSchema), { status: 415 })
  })
})

test('a valid deployment hostname cannot bypass missing or malformed canonical configuration', async () => {
  for (const canonical of [undefined, '', 'invalid', CANONICAL + '/path', CANONICAL + '?x=1']) {
    await withEnvironment({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SITE_URL: canonical }, async () => {
      assert.throws(() => isTrustedAuthOrigin(PREVIEW))
      await assert.rejects(readAuthRequest(request(PREVIEW), emailRequestSchema))
    })
  }
})

test('existing local development origins remain accepted without Preview allowance', async () => {
  for (const canonical of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    await withEnvironment({ NODE_ENV: 'development', VERCEL: undefined, VERCEL_ENV: 'development',
      NEXT_PUBLIC_SITE_URL: canonical }, async () => {
      assert.deepEqual(await readAuthRequest(request(canonical), emailRequestSchema), { email: 'student@example.test' })
      await assert.rejects(readAuthRequest(request(PREVIEW), emailRequestSchema), { status: 403 })
    })
  }
})

test('deployment hostname normalization and changes trust only the currently configured deployment', async () => {
  await withEnvironment({ VERCEL_ENV: 'preview', VERCEL_URL: 'PREVIEW-CURRENT.VERCEL.APP' }, async () => {
    assert.deepEqual(await readAuthRequest(request(PREVIEW), emailRequestSchema), { email: 'student@example.test' })
    process.env.VERCEL_URL = 'preview-other.vercel.app'
    await assert.rejects(readAuthRequest(request(PREVIEW), emailRequestSchema), { status: 403 })
    assert.deepEqual(await readAuthRequest(request(OTHER_PREVIEW), emailRequestSchema), { email: 'student@example.test' })
  })
})
