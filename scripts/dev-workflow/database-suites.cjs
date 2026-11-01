// scripts/dev-workflow/database-suites.cjs — Name the database race suites, their opt-in flags and the stack they run on.
const fs = require('node:fs')
const path = require('node:path')

const DATABASE_SUITE = /\.database\.test\.cjs$/
// Suites that cannot run on the current migrations, with the reason. Every other database suite runs.
const RETIRED_SUITES = new Map([
  ['lib/courses/access-scope-upgrade.database.test.cjs', 'it replays the own-course-access upgrade on a database ' +
    'from before 20261029100000_own_course_access.sql, and develop now includes that migration'],
])
// Each suite's opt-in flag, set to 1, and each variable that names the database container a suite runs against.
const FLAGS = [
  'ACCESS_SCOPE_DB_TEST', 'ACCOUNT_DELETION_DB_TEST', 'AI_PRACTICE_DB_TEST', 'BUA_CATALOGUE_DB_TEST',
  'COURSE_LINKS_DB_TEST', 'COURSE_SELECTION_DB_TEST', 'ENTITLEMENT_DB_TEST', 'PRACTICE_DB_TEST',
  'PROFILE_CONCURRENCY_DB_TEST', 'RECOVERY_FLOW_ISOLATION_DB_TEST', 'SESSION_GENERATION_DB_TEST',
]
const CONTAINER_VARIABLES = [
  'ACCESS_SCOPE_DB_CONTAINER', 'ACCOUNT_DELETION_DB_CONTAINER', 'AI_PRACTICE_DB_CONTAINER', 'BUA_CATALOGUE_DB_CONTAINER',
  'COURSE_LINKS_DB_CONTAINER', 'COURSE_SELECTION_DB_CONTAINER', 'ENTITLEMENT_DB_CONTAINER', 'PRACTICE_DB_CONTAINER',
  'PROFILE_CONCURRENCY_DB_CONTAINER', 'RECOVERY_FLOW_ISOLATION_DB_CONTAINER',
]
// The suites commit rows, so they run only on a stack made for tests; the access-scope suites refuse any other name.
const TEST_STACK = /^ci-access-own-[a-z0-9-]+$/

/** The Supabase project the CLI is using: SUPABASE_PROJECT_ID, else project_id in the (SUPABASE_WORKDIR) config. */
function projectId(root, env) {
  if (env.SUPABASE_PROJECT_ID) return env.SUPABASE_PROJECT_ID
  const config = path.join(path.resolve(root, env.SUPABASE_WORKDIR || '.'), 'supabase', 'config.toml')
  try { return /^project_id\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(config, 'utf8'))?.[1] ?? null } catch { return null }
}

/** The variables that switch every suite on against one database container. */
function suiteEnvironment(container) {
  return Object.fromEntries([...FLAGS.map(flag => [flag, '1']),
    ...CONTAINER_VARIABLES.map(variable => [variable, container])])
}

module.exports = { CONTAINER_VARIABLES, DATABASE_SUITE, FLAGS, RETIRED_SUITES, TEST_STACK, projectId, suiteEnvironment }
