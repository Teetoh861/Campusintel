// scripts/ai-practice/grant-test-allowance.cjs — Issue a controlled TEST AI grant on a LOCAL Supabase stack.
// The app honours it only with AI_PRACTICE_ACCEPT_TEST_GRANTS=true in a verified local environment (next dev or a
// test run against a loopback Supabase URL; see lib/ai-practice/entitlement.ts). Refuses non-local URLs.
//   AI_IT_URL=http://127.0.0.1:54321 AI_IT_SECRET_KEY=... \
//   node scripts/ai-practice/grant-test-allowance.cjs --user <uuid> --units 3 --days 1
const { createClient } = require('@supabase/supabase-js')

const LOCAL_HOSTS = ['127.0.0.1', 'localhost']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const url = process.env.AI_IT_URL
  const secret = process.env.AI_IT_SECRET_KEY
  const user = argument('user')
  const units = Number(argument('units'))
  const days = Number(argument('days'))
  if (!url || !secret || !LOCAL_HOSTS.includes(new URL(url).hostname)) {
    throw new Error('set AI_IT_URL (local only) and AI_IT_SECRET_KEY')
  }
  if (!user || !UUID.test(user) || !Number.isInteger(units) || !Number.isInteger(days)) {
    throw new Error('usage: --user <uuid> --units <integer> --days <integer>')
  }
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.rpc('issue_ai_allowance_grant',
    { p_user_id: user, p_source: 'test', p_units: units, p_days: days })
  if (error) throw new Error(`grant refused (${error.code ?? 'unknown'})`)
  process.stdout.write(`${JSON.stringify(data)}\n`)
}

main().catch(error => {
  process.stderr.write(`grant-test-allowance: ${error instanceof Error ? error.message : 'failed'}\n`)
  process.exitCode = 1
})
