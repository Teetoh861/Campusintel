const { AuthSettingsError, readSupabaseUrl, readSupabasePublishableKey, readAuthSecretKey,
  readAuthInternalSecret, readAuthOrigin } = require('../../lib/auth/settings.cjs')

/** Keep deployment metadata on one line; no setting value is ever included in output. */
function label(value, fallback) {
  return typeof value === 'string' && /^[A-Za-z0-9_./-]{1,128}$/.test(value) ? value : fallback
}

/** Fail live/test Vercel builds only, using the same production rules as next build. */
function checkAuthSettings(env) {
  const environment = label(env.VERCEL_ENV, 'local')
  const branch = label(env.VERCEL_GIT_COMMIT_REF, 'unknown')
  const context = `(${environment}, ${branch})`
  const required = env.VERCEL === '1' && env.STUDENT_AUTH_ENABLED === 'true' &&
    (env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'develop')
  if (!required) {
    console.log(`CampusIntell sign-in settings: SKIPPED ${context}`)
    return 0
  }

  // Next sets NODE_ENV itself; this script runs before Next and must enforce its production key rule.
  const buildEnv = { ...env, NODE_ENV: 'production' }
  const checks = [
    ['NEXT_PUBLIC_SUPABASE_URL', readSupabaseUrl],
    ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', readSupabasePublishableKey],
    ['SUPABASE_SECRET_KEY', readAuthSecretKey],
    ['AUTH_INTERNAL_SECRET', readAuthInternalSecret],
    ['NEXT_PUBLIC_SITE_URL', readAuthOrigin],
  ]
  const problems = new Map()
  for (const [setting, read] of checks) {
    try { read(buildEnv) }
    catch (error) {
      const problem = error instanceof AuthSettingsError ? error : { setting, problem: 'wrong format' }
      problems.set(problem.setting, problem.problem)
    }
  }
  if (problems.size) {
    for (const [setting, problem] of problems) console.error(`CampusIntell sign-in settings: ${setting} ${problem} ${context}`)
    return 1
  }
  console.log(`CampusIntell sign-in settings: OK ${context}`)
  return 0
}

if (require.main === module) process.exitCode = checkAuthSettings(process.env)
module.exports = { checkAuthSettings }
