// lib/payments/config.test.cjs — Provider selection fails closed: the fake only in a verified local environment, a live
// key only in production, nothing without webhook secrets.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readPaymentsConfig } = require('./config.ts')
const { createFakeProvider } = require('./fake.ts')

const LOCAL = { NODE_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }
const SECRETS = { BACHS_WEBHOOK_SECRET: 'whsec_current_value_0001' }

test('live money is available only on the live project in Vercel production; refusals log no key', () => {
  const live = { NODE_ENV: 'production', VERCEL_ENV: 'production', ...SECRETS,
    NEXT_PUBLIC_SUPABASE_URL: 'https://ckhkrognfftrqsjtablr.supabase.co', BACHS_API_KEY: 'sk_live_fixture_only' }
  const errors = [], saved = console.error
  let sent = 0
  try {
    console.error = (...args) => errors.push(args.join(' '))
    const fetcher = () => { sent++; throw new Error('no provider calls during configuration') }
    assert.equal(readPaymentsConfig(live, { fetch: fetcher }).checkoutProvider?.id, 'bachs')
    for (const override of [
      { NEXT_PUBLIC_SUPABASE_URL: 'https://znwluaiylogqapansuht.supabase.co' },
      { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }, { VERCEL_ENV: undefined },
      { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', VERCEL_ENV: undefined },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://ckhkrognfftrqsjtablr.supabase.co.evil.test' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://ckhkrognfftrqsjtablr.supabase.co/path' },
    ]) {
      const env = { ...live, ...override }
      const refused = readPaymentsConfig(env, { fetch: fetcher })
      assert.equal(refused.checkoutProvider, null)
      assert.equal(refused.providerFor('bachs'), null)
      assert.match(errors.at(-1), /live key refused/)
      assert.equal(readPaymentsConfig({ ...env, BACHS_API_KEY: 'sk_sandbox_fixture_only' }).checkoutProvider?.id, 'bachs')
    }
    assert.equal(sent, 0)
    assert.doesNotMatch(errors.join(' '), /sk_live_|whsec_/)
  } finally { console.error = saved }
})

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
  assert.equal(readPaymentsConfig({ ...SECRETS, NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://ckhkrognfftrqsjtablr.supabase.co', BACHS_API_KEY: 'sk_live_abcdefgh123' })
    .checkoutProvider?.id, 'bachs')
  assert.equal(readPaymentsConfig({ ...SECRETS, NODE_ENV: 'production', BACHS_API_KEY: 'not-a-key' }).checkoutProvider, null)
  // A previous secret alone (mid-rotation mistake) still verifies; neither secret means nothing is accepted.
  assert.equal(readPaymentsConfig({ ...LOCAL, BACHS_WEBHOOK_SECRET_PREVIOUS: 'whsec_previous_value_0002',
    BACHS_API_KEY: 'sk_sandbox_abcdefgh123' }).providerFor('bachs')?.id, 'bachs')
  assert.equal(readPaymentsConfig({ ...LOCAL, ...SECRETS, BACHS_API_KEY: 'sk_sandbox_abcdefgh123' }).providerFor('stripe'), null)
})
