// Shared, dependency-free setting rules for the server runtime and the Node build check.
/** @typedef {Record<string, string | undefined>} AuthEnvironment */
/** @typedef {'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' | 'SUPABASE_SECRET_KEY' | 'AUTH_INTERNAL_SECRET' | 'NEXT_PUBLIC_SITE_URL'} AuthSetting */
/** @typedef {'missing' | 'too short' | 'wrong format'} SettingProblem */
/** @typedef {(setting: AuthSetting, problem: SettingProblem) => Error} SettingFailure */

const AUTH_INTERNAL_SECRET_MIN_BYTES = 32

class AuthSettingsError extends Error {
  /** @param {AuthSetting} setting @param {SettingProblem} problem */
  constructor(setting, problem) {
    super(`${setting}: ${problem}`)
    this.setting = setting
    this.problem = problem
  }
}

/** @type {SettingFailure} */
const settingFailure = (setting, problem) => new AuthSettingsError(setting, problem)

/** Validate only the public project URL rules already enforced at runtime.
 * @param {AuthEnvironment} env @param {SettingFailure} failure
 */
function readSupabaseUrl(env, failure = settingFailure) {
  const value = env.NEXT_PUBLIC_SUPABASE_URL
  if (!value) throw failure('NEXT_PUBLIC_SUPABASE_URL', 'missing')
  let url
  try { url = new URL(value) }
  catch { throw failure('NEXT_PUBLIC_SUPABASE_URL', 'wrong format') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw failure('NEXT_PUBLIC_SUPABASE_URL', 'wrong format')
  }
  return value
}

/** Preserve the existing non-empty, unpadded public-key rule; do not impose a new key prefix.
 * @param {AuthEnvironment} env @param {SettingFailure} failure
 */
function readSupabasePublishableKey(env, failure = settingFailure) {
  const value = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!value) throw failure('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'missing')
  if (value !== value.trim()) throw failure('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'wrong format')
  return value
}

/** @param {AuthEnvironment} env @param {SettingFailure} failure */
function readSupabaseConfig(env, failure = settingFailure) {
  return { url: readSupabaseUrl(env, failure), key: readSupabasePublishableKey(env, failure) }
}

/** Legacy JWTs remain permitted in production only for a configured loopback Supabase URL.
 * @param {AuthEnvironment} env @param {SettingFailure} failure
 */
function readAuthSecretKey(env, failure = settingFailure) {
  const key = env.SUPABASE_SECRET_KEY
  if (!key) throw failure('SUPABASE_SECRET_KEY', 'missing')
  if (!key.trim()) throw failure('SUPABASE_SECRET_KEY', 'wrong format')
  if (env.NODE_ENV === 'production') {
    let local = false
    let invalidUrl = false
    try {
      const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || '')
      local = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    } catch { invalidUrl = true }
    const modern = /^sb_secret_[A-Za-z0-9_-]+$/.test(key)
    // Structural validation only; Supabase still validates the JWT signature and role.
    const localJwt = local && key.length >= 64 &&
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key) &&
      key.split('.').every(segment => segment.length % 4 !== 1)
    if (!modern && !localJwt) throw failure('SUPABASE_SECRET_KEY', 'wrong format')
    if (invalidUrl) throw failure('NEXT_PUBLIC_SUPABASE_URL', env.NEXT_PUBLIC_SUPABASE_URL ? 'wrong format' : 'missing')
  }
  if (key !== key.trim()) throw failure('SUPABASE_SECRET_KEY', 'wrong format')
  return key
}

/** Preserve the UTF-8 byte minimum, without adding trimming or entropy rules.
 * @param {AuthEnvironment} env @param {SettingFailure} failure
 */
function readAuthInternalSecret(env, failure = settingFailure) {
  const secret = env.AUTH_INTERNAL_SECRET
  if (!secret) throw failure('AUTH_INTERNAL_SECRET', 'missing')
  if (Buffer.byteLength(secret) < AUTH_INTERNAL_SECRET_MIN_BYTES) throw failure('AUTH_INTERNAL_SECRET', 'too short')
  return secret
}

/** Return the canonical origin; HTTP remains allowed only on loopback.
 * @param {AuthEnvironment} env @param {SettingFailure} failure
 */
function readAuthOrigin(env, failure = settingFailure) {
  if (!env.NEXT_PUBLIC_SITE_URL) throw failure('NEXT_PUBLIC_SITE_URL', 'missing')
  let url
  try { url = new URL(env.NEXT_PUBLIC_SITE_URL) }
  catch { throw failure('NEXT_PUBLIC_SITE_URL', 'wrong format') }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw failure('NEXT_PUBLIC_SITE_URL', 'wrong format')
  }
  return url.origin
}

module.exports = { AUTH_INTERNAL_SECRET_MIN_BYTES, AuthSettingsError, readSupabaseUrl, readSupabasePublishableKey,
  readSupabaseConfig, readAuthSecretKey, readAuthInternalSecret, readAuthOrigin }
