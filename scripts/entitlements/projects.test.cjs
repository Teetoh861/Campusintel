const { test } = require('node:test')
const assert = require('node:assert/strict')
const { run } = require('./ops.cjs')
const { PROJECT_REFS } = require('../../lib/supabase/projects.cjs')

const COMMANDS = ['status', 'grant', 'change-grant', 'early-access-report', 'configure-early-access', 'activate-launch',
  'purge-claims', 'claim-keys', 'selection-status', 'selection-change', 'calendar', 'term-set', 'term-extend',
  'course-add', 'course-status', 'course-revoke', 'payment-status', 'payments-health', 'open-sales', 'close-sales',
  'campus-bot-model', 'campus-bot-cap', 'campus-bot-writer', 'campus-bot-refill', 'ai-limits', 'payment-verify',
  'payment-fulfil', 'refund', 'refund-retry', 'reconcile-now', 'tester-grant', 'tester-revoke', 'tester-status']
COMMANDS.push('campus-bot-feature', 'campus-bot-reply-limits', 'campus-bot-checker', 'campus-bot-set-checker',
  'campus-bot-course', 'campus-bot-clear-explanations', 'campus-bot-status', 'campus-bot-explanations',
  'import-early-access', 'member', 'reconcile-early-access')

test('every command refuses a missing, invalid or mismatched project before reading a key or sending anything', async () => {
  let reads = 0, sent = 0
  const env = { NEXT_PUBLIC_SUPABASE_URL: `https://${PROJECT_REFS.test}.supabase.co`,
    get SUPABASE_SECRET_KEY() { reads++; throw new Error('key must remain unread') } }
  const transport = () => { sent++; throw new Error('must never send') }
  for (const command of COMMANDS) {
    for (const flags of [[], ['--project', 'local'], ['--project', 'production'],
      ['--project', 'production', '--project', 'test']]) {
      await assert.rejects(run([command, ...flags], env, transport), /--project|project production requires/)
    }
  }
  for (const project of Object.keys(PROJECT_REFS)) {
    for (const url of ['http://127.0.0.1:54321', `http://${PROJECT_REFS[project]}.supabase.co`,
      `https://${PROJECT_REFS[project]}.supabase.co.evil.test`, `https://${PROJECT_REFS[project]}.supabase.co/rest`,
      `https://${PROJECT_REFS[project]}.supabase.co?test=1`, `https://${PROJECT_REFS[project]}.supabase.co:54321`,
      `https://user@${PROJECT_REFS[project]}.supabase.co`, undefined]) {
      await assert.rejects(run(['status', '--project', project], {
        NEXT_PUBLIC_SUPABASE_URL: url, get SUPABASE_SECRET_KEY() { reads++; throw new Error('unread') } }, transport),
      /nothing was sent/)
    }
  }
  assert.equal(reads, 0)
  assert.equal(sent, 0)
})

test('each matching target is named in its result', async () => {
  for (const project of Object.keys(PROJECT_REFS)) {
    const printed = []
    await run(['claim-keys', '--project', project], {
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROJECT_REFS[project]}.supabase.co`, SUPABASE_SECRET_KEY: 'sb_secret_fixture',
    }, async () => Response.json({ live: [], registered: [] }), text => printed.push(JSON.parse(text)))
    assert.deepEqual(printed, [{ live: [], registered: [], project }])
  }
})
