// lib/auth/email-release-contract.test.cjs — Repository OTP and identity contracts, never external delivery claims.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { AUTH_OTP_TYPES } = require('./constants.ts')
const { CONTACT_EMAIL } = require('../contact.ts')
const { MATERIAL_EMAIL } = require('../material-email.ts')

const root = resolve(__dirname, '../..')
const read = file => readFileSync(resolve(root, file), 'utf8')

test('hosted deployment sources show the correct OTP variable and retain purpose-specific verification', () => {
  const config = read('supabase/config.toml')
  for (const [kind, subject] of [
    ['confirmation', 'Confirm your CampusIntell email'], ['recovery', 'Reset your CampusIntell password'],
  ]) {
    const section = new RegExp(`\\[auth\\.email\\.template\\.${kind}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(config)?.[1]
    assert.ok(section, kind)
    assert.ok(section.includes(`subject = "${subject}"`))
    assert.ok(section.includes(`content_path = "./supabase/templates/${kind}.html"`))
    const html = read(`supabase/templates/${kind}.html`)
    assert.match(html, /\{\{\s*\.Token\s*\}\}/)
    assert.match(html, /Enter this code on CampusIntell/)
    assert.doesNotMatch(html, /\.TokenHash|\.ConfirmationURL|\.RedirectTo|href\s*=|<script|<form/i)
    assert.match(html, /Do not share this code/)
  }
  assert.deepEqual(AUTH_OTP_TYPES, { confirmation: 'signup', recovery: 'recovery' })
})

test('deployment identity is approved and material requests remain a separate channel', () => {
  const contract = read('docs/transactional-email-release.md')
  for (const exact of ['Resend', 'auth.campusintell.com', 'CampusIntell', 'no-reply@auth.campusintell.com',
    'hello@campusintell.com', 'campusintell@gmail.com', 'Reply-To: hello@campusintell.com']) {
    assert.ok(contract.includes(exact), exact)
  }
  assert.equal(CONTACT_EMAIL, 'hello@campusintell.com')
  assert.equal(MATERIAL_EMAIL, 'campusintell@gmail.com')
})

test('local SMTP remains captured and the disabled external example uses Resend without credentials', () => {
  const config = read('supabase/config.toml')
  assert.match(config, /\[local_smtp\]\s*\nenabled = true/)
  assert.doesNotMatch(config, /^\[auth\.email\.smtp\]/m)
  assert.match(config, /# host = "smtp\.resend\.com"/)
  assert.match(config, /# pass = "env\(RESEND_SMTP_PASSWORD\)"/)
  assert.doesNotMatch(config, /sendgrid|admin@email\.com|sender_name = "Admin"/i)
})
