// Public project identities shared by launch guards. No credential is read here.
const PROJECT_REFS = Object.freeze({ test: 'znwluaiylogqapansuht', production: 'ckhkrognfftrqsjtablr' })

/** Whether a value is exactly the named Supabase project's HTTPS origin. */
function matchesSupabaseProject(project, value) {
  if (!Object.hasOwn(PROJECT_REFS, project) || typeof value !== 'string' || value !== value.trim()) return false
  try {
    const url = new URL(value)
    return url.origin === `https://${PROJECT_REFS[project]}.supabase.co` && url.pathname === '/'
      && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}

module.exports = { PROJECT_REFS, matchesSupabaseProject }
