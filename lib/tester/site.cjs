// lib/tester/site.cjs — Owner tester access: whether this process talks to the test site's database.
// Shared, dependency-free, by the server and by scripts/entitlements/tester.cjs (removable with the feature,
// supabase/migrations/20261125200000_owner_tester_access.sql). The database decides every tester effect by itself
// from its own test-site row; this check only lets the app honour what the database reports. It reads one value, the
// Supabase URL, and nothing else: no deployment flag, VERCEL_ENV or other variable can switch it on.

/** The test site's Supabase project. A public identifier (it is in every page of the test site), not a credential. */
const TEST_PROJECT_REF = 'znwluaiylogqapansuht'
const TEST_PROJECT_HOST = `${TEST_PROJECT_REF}.supabase.co`
// A local stack on this machine, which has the test-site row only if someone inserted it there by hand.
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost']

/** @param {string | undefined} value @returns {URL | null} */
function plainOrigin(value) {
  if (typeof value !== 'string' || value === '' || value !== value.trim()) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null
    return url
  } catch {
    return null
  }
}

/**
 * True only for the test project over HTTPS, or a loopback Supabase URL (local verification). Fails closed.
 * @param {Readonly<Record<string, string | undefined>>} [env]
 * @returns {boolean}
 */
function isTesterSite(env = process.env) {
  const url = plainOrigin(env.NEXT_PUBLIC_SUPABASE_URL)
  if (url === null) return false
  if (url.protocol === 'https:' && url.hostname === TEST_PROJECT_HOST && url.port === '') return true
  return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.includes(url.hostname)
}

/**
 * A Campus Bot admission the database funded through tester access, received by a server that is not on the test
 * site: the server never calls the provider for it (the reservation lapses and is released at no charge).
 * Reads the raw answer, because the admission parsers drop keys they do not know.
 * @param {unknown} data @param {Readonly<Record<string, string | undefined>>} [env] @returns {boolean}
 */
function fundedByTesterOffSite(data, env = process.env) {
  return typeof data === 'object' && data !== null && /** @type {{ funding?: unknown }} */ (data).funding === 'tester'
    && !isTesterSite(env)
}

/**
 * Where the tester operator command may send anything: exactly the test project over HTTPS, or a loopback local stack
 * only from a positively local run (NODE_ENV development or test, VERCEL_ENV unset), as isVerifiedLocalEnvironment
 * requires (lib/ai-practice/entitlement.ts).
 * @param {Readonly<Record<string, string | undefined>>} [env] @returns {boolean}
 */
function isTesterOperatorTarget(env = process.env) {
  const url = plainOrigin(env.NEXT_PUBLIC_SUPABASE_URL)
  if (url === null) return false
  if (url.protocol === 'https:' && url.hostname === TEST_PROJECT_HOST && url.port === '') return true
  return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.includes(url.hostname)
    && ['development', 'test'].includes(env.NODE_ENV ?? '') && env.VERCEL_ENV === undefined
}

module.exports = { TEST_PROJECT_REF, TEST_PROJECT_HOST, isTesterSite, isTesterOperatorTarget, fundedByTesterOffSite }
