// lib/payments/config.test.cjs — Provider selection fails closed: the fake only in a verified local environment, a live
// key only in production, nothing without webhook secrets.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readPaymentsConfig } = require('./config.ts')
const { createFakeProvider } = require('./fake.ts')

const LOCAL = { NODE_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }
const SECRETS = { BACHS_WEBHOOK_SECRET: 'whsec_current_value_0001' }

test('the fake provider exists only in a verified local environment', () => {
  const fake = createFakeProvider()
  const local = readPaymentsConfig({ ...LOCAL, PAYMENTS_PROVIDER: 'fake' }, { fake })
  assert.equal(local.checkoutProvider, fake)
  assert.equal(local.providerFor('fake'), fake)
  for (const env of [
    { ...LOCAL, PAYMENTS_PROVIDER: 'fake', NODE_ENV: 'production' },
    { ...LOCAL, PAYMENTS_PROVIDER: 'fake', NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' },
    { ...LOCAL, PAYMENTS_PROVIDER: 'fake', VERCEL_ENV: 'preview' },
    { ...LOCAL, PAYMENTS_PROVIDER: 'fake', NODE_ENV: undefined },
  ]) {
    const config = readPaymentsConfig(env, { fake })
    // Asking for the fake anywhere else sells nothing, rather than falling back to real money.
    assert.equal(config.checkoutProvider, null)
    assert.equal(config.providerFor('fake'), null)
  }
})

test('Bachs needs a valid key and at least one webhook secret; a live key needs a production build', () => {
  assert.equal(readPaymentsConfig({ ...LOCAL, ...SECRETS, BACHS_API_KEY: 'sk_sandbox_abcdefgh123' }).checkoutProvider?.id, 'bachs')
  assert.equal(readPaymentsConfig({ ...LOCAL, BACHS_API_KEY: 'sk_sandbox_abcdefgh123' }).checkoutProvider, null)
  assert.equal(readPaymentsConfig({ ...LOCAL, BACHS_API_KEY: 'sk_sandbox_abcdefgh123', BACHS_WEBHOOK_SECRET: 'short' })
    .checkoutProvider, null)
  assert.equal(readPaymentsConfig({ ...LOCAL, ...SECRETS, BACHS_API_KEY: 'sk_live_abcdefgh123' }).checkoutProvider, null)
  assert.equal(readPaymentsConfig({ ...SECRETS, NODE_ENV: 'production', BACHS_API_KEY: 'sk_live_abcdefgh123' })
    .checkoutProvider?.id, 'bachs')
  assert.equal(readPaymentsConfig({ ...SECRETS, NODE_ENV: 'production', BACHS_API_KEY: 'not-a-key' }).checkoutProvider, null)
  // A previous secret alone (mid-rotation mistake) still verifies; neither secret means nothing is accepted.
  assert.equal(readPaymentsConfig({ ...LOCAL, BACHS_WEBHOOK_SECRET_PREVIOUS: 'whsec_previous_value_0002',
    BACHS_API_KEY: 'sk_sandbox_abcdefgh123' }).providerFor('bachs')?.id, 'bachs')
  assert.equal(readPaymentsConfig({ ...LOCAL, ...SECRETS, BACHS_API_KEY: 'sk_sandbox_abcdefgh123' }).providerFor('stripe'), null)
})
