// lib/auth/security.test.ts — Regression checks for redirects, rollout, request bounds and cookie policy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSafeReturnPath } from './redirect'
import { getStudentCookieOptions } from './cookies'
import { isStudentAuthEnabled } from './config'
import { readAuthRequest } from './request'
import { registerSchema, resetSchema, codeSchema } from './schemas'
import { DEFAULT_AUTH_REDIRECT } from './constants'

// Executed in Node with the test-only server-only shim; no provider calls or real secrets.
test('redirects reject external, encoded, control, privileged and looping destinations', () => {
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', '/%2f%2fevil.test',
    '/api/auth/login', '/admin', '/ADMIN/users', '/auth/confirm', '/login', '/confirm-email',
    '/courses?code=123', '/courses#code', '/courses\n', '/a/../admin', '/a/%2e%2e/admin']) {
    assert.equal(getSafeReturnPath(path), DEFAULT_AUTH_REDIRECT)
  }
  assert.equal(getSafeReturnPath('/account'), '/account')
  assert.equal(getSafeReturnPath('/courses/business-statistics'), '/courses/business-statistics')
})

test('schemas normalize email but preserve passwords and reject extra identifiers', () => {
  const parsed = registerSchema.parse({ email: ' Student@Example.test ', password: '  unchanged  ' })
  assert.equal(parsed.email, 'student@example.test')
  assert.equal(parsed.password, '  unchanged  ')
  assert.equal(resetSchema.safeParse({ email: 'a@example.test', code: '123456', password: 'password', user_id: 'x' }).success, false)
  assert.equal(codeSchema.safeParse('12345678').success, true)
  assert.equal(codeSchema.safeParse('12a').success, false)
  assert.equal(codeSchema.safeParse('1'.repeat(100)).success, false)
})

test('rollout is exact; disabled, cross-origin, malformed and oversized requests fail closed', async () => {
  const oldFlag = process.env.STUDENT_AUTH_ENABLED
  const oldOrigin = process.env.NEXT_PUBLIC_SITE_URL
  const req = (body: string, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/auth/register', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body,
  })
  try {
    for (const value of [undefined, 'false', 'TRUE', '1', 'true ']) {
      if (value === undefined) delete process.env.STUDENT_AUTH_ENABLED
      else process.env.STUDENT_AUTH_ENABLED = value
      assert.equal(isStudentAuthEnabled(), false)
      await assert.rejects(readAuthRequest(req('{}'), registerSchema), { status: 503 })
    }
    process.env.STUDENT_AUTH_ENABLED = 'true'
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
    assert.equal(isStudentAuthEnabled(), true)
    await assert.rejects(readAuthRequest(req('{}', 'https://evil.test'), registerSchema), { status: 403 })
    await assert.rejects(readAuthRequest(req('{'), registerSchema), { status: 400 })
    await assert.rejects(readAuthRequest(req(' '.repeat(5000)), registerSchema), { status: 413 })
  } finally {
    if (oldFlag === undefined) delete process.env.STUDENT_AUTH_ENABLED
    else process.env.STUDENT_AUTH_ENABLED = oldFlag
    if (oldOrigin === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = oldOrigin
  }
})

test('cookie hardening preserves rotation metadata and enforces production Secure', () => {
  const previous = process.env.NODE_ENV
  try {
    Object.assign(process.env, { NODE_ENV: 'production' })
    const expires = new Date('2030-01-01')
    const options = getStudentCookieOptions({ expires, maxAge: 99, httpOnly: false, secure: false, sameSite: 'none' })
    assert.equal(options.expires, expires)
    assert.equal(options.maxAge, 99)
    assert.equal(options.httpOnly, true)
    assert.equal(options.sameSite, 'lax')
    assert.equal(options.secure, true)
    assert.equal(options.path, '/')
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV')
    else Object.assign(process.env, { NODE_ENV: previous })
  }
})
