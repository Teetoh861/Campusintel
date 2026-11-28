// Run explicitly with an operator's environment credentials; never reads a repository env file.
const fs = require('node:fs')
const { createClient } = require('@supabase/supabase-js')
const { validatePack } = require('./pack.cjs')

/** Validate or import one private pack. Import retries reuse the owner's explicit event UUID. */
async function main(args) {
  const [action, file, ...flags] = args
  if (!['validate', 'import'].includes(action) || !file) throw new Error('Use: node scripts/orientation/import.cjs validate|import <private-pack.json> [--event-id UUID --url URL]')
  const stat = fs.statSync(file)
  if (stat.size > 100_000) throw new Error('Question pack is too large.')
  let pack
  try { pack = validatePack(JSON.parse(fs.readFileSync(file, 'utf8'))) }
  catch { throw new Error('Invalid pack: check categories, lengths, fifteen main questions, three general or CampusIntell spares, and one correct option per question.') }
  if (action === 'validate') { process.stdout.write(`PASS: 15 main questions and ${pack.questions.length - 15} spares.\n`); return }
  const get = name => { const i = flags.indexOf(name); return i < 0 ? undefined : flags[i + 1] }
  const id = get('--event-id'), target = get('--url')
  if (!id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || !target) throw new Error('An explicit event UUID and Supabase URL are required.')
  const url = new URL(target), local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (!local && (url.protocol !== 'https:' || !flags.includes('--allow-hosted')))) throw new Error('Target refused. Hosted imports require an explicit HTTPS URL and --allow-hosted.')
  const { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, ORIENTATION_OPERATOR_EMAIL: email, ORIENTATION_OPERATOR_PASSWORD: password } = process.env
  if (!key || !email || !password) throw new Error('Provide public project configuration and operator credentials through the environment.')
  const client = createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  try {
    const signed = await client.auth.signInWithPassword({ email, password })
    if (signed.error || !signed.data.session) throw new Error('Operator sign-in failed.')
    const result = await client.rpc('orientation_import', { p_event: id, p_pack: pack })
    if (result.error || result.data !== id) throw new Error('Import refused. Check operator access, target, and event identity.')
    process.stdout.write('PASS: checked pack imported into a draft event. Load it on the host screen.\n')
  } finally { await client.auth.signOut({ scope: 'local' }).catch(() => {}) }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
module.exports = { main }
