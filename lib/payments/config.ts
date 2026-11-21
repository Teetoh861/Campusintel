// lib/payments/config.ts — Which provider takes new checkouts and which can verify an existing order. Fails closed:
// without a valid Bachs key nothing is sold, and the fake provider exists only in a verified local environment (the
// same rule as AI_PRACTICE_ACCEPT_TEST_GRANTS), so asking for it anywhere else sells nothing rather than faking money.
// Secrets are read here and passed to the adapter only; they are never logged or returned.
import 'server-only'
import { isVerifiedLocalEnvironment } from '@/lib/ai-practice/entitlement'
import { bachsApiBase, createBachsProvider } from './bachs'
import { createFakeProvider } from './fake'
import type { FakeProvider } from './fake'
import type { PaymentProvider, ProviderId } from './provider'

type Env = Readonly<Record<string, string | undefined>>
const MIN_WEBHOOK_SECRET_LENGTH = 16

export type PaymentsConfig = {
  /** The provider new checkouts go to, or null when payments are not configured here. */
  checkoutProvider: PaymentProvider | null
  /** The provider an existing order (by its stored provider id) is verified with, or null when it is not allowed here. */
  providerFor(id: string): PaymentProvider | null
}

let localFake: FakeProvider | null = null
/** One fake per process, so a local checkout and its later verification see the same answers. */
export function localFakeProvider(): FakeProvider {
  localFake ??= createFakeProvider()
  return localFake
}

export function fakeProviderAllowed(env: Env = process.env): boolean {
  return env.PAYMENTS_PROVIDER === 'fake' && isVerifiedLocalEnvironment(env)
}

function webhookSecrets(env: Env): string[] {
  return [env.BACHS_WEBHOOK_SECRET, env.BACHS_WEBHOOK_SECRET_PREVIOUS]
    .filter((secret): secret is string => typeof secret === 'string' && secret === secret.trim()
      && secret.length >= MIN_WEBHOOK_SECRET_LENGTH)
}

export function readPaymentsConfig(env: Env = process.env, options: { fetch?: typeof fetch; fake?: FakeProvider } = {}):
  PaymentsConfig {
  const key = env.BACHS_API_KEY ?? ''
  const base = bachsApiBase(key)
  // A live key moves real money, so it is used only by a production build; a sandbox key works anywhere.
  const keyAllowed = base !== null && (key.startsWith('sk_sandbox_') || env.NODE_ENV === 'production')
  const secrets = webhookSecrets(env)
  const bachs = keyAllowed && secrets.length > 0
    ? createBachsProvider({ apiKey: key, webhookSecrets: secrets, fetch: options.fetch }) : null
  const fake = fakeProviderAllowed(env) ? options.fake ?? localFakeProvider() : null
  const providers: Partial<Record<ProviderId, PaymentProvider>> = { ...(bachs ? { bachs } : {}), ...(fake ? { fake } : {}) }
  return {
    checkoutProvider: env.PAYMENTS_PROVIDER === 'fake' ? fake : bachs,
    providerFor: id => (id === 'bachs' || id === 'fake') ? providers[id] ?? null : null,
  }
}
