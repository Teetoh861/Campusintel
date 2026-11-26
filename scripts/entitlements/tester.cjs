// scripts/entitlements/tester.cjs — Owner tester access on the test site (removable with
// supabase/migrations/20261125200000_owner_tester_access.sql). Dispatched from ops.cjs:
//   node scripts/entitlements/ops.cjs tester-grant --user <uuid> [--days <1-30, default 7>] [--daily-cap <tokens>]
//       --actor <name> --reason <text>
//       Switches tester access on, or renews it: it then ends <days> after this moment.
//   node scripts/entitlements/ops.cjs tester-revoke --user <uuid> --actor <name> --reason <text>
//   node scripts/entitlements/ops.cjs tester-status [--user <uuid>]
//       The test-site setting, each tester's state, end, who set it and why, and today's Campus Bot use against the cap.
// Every tester command refuses any project but the test one before the key is read or anything is sent. A local stack
// (127.0.0.1 or localhost) is accepted only with NODE_ENV development or test and VERCEL_ENV unset. The database
// refuses too, unless its own test-site row is there.
const { isTesterOperatorTarget, TEST_PROJECT_REF } = require('../../lib/tester/site.cjs')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMMANDS = new Set(['tester-grant', 'tester-revoke', 'tester-status'])

function isTesterCommand(command) {
  return COMMANDS.has(command)
}

/** Throws unless the configured Supabase URL is the test project or a local stack. Sends nothing. */
function assertTesterProject(env) {
  if (!isTesterOperatorTarget(env)) {
    throw new Error(`tester commands run only against the test project (${TEST_PROJECT_REF}) or, from a local ` +
      'development or test run, a local stack; nothing was sent')
  }
}

function optionalInteger(opts, name, integer) {
  return opts[name] === undefined ? null : integer(opts, name)
}

/** The RPC a tester command calls, or null for any other command. */
function testerCall(command, opts, { required, integer, note }) {
  switch (command) {
    case 'tester-grant': {
      const days = optionalInteger(opts, 'days', integer)
      if (days !== null && (days < 1 || days > 30)) throw new Error('--days must be 1 to 30')
      const cap = optionalInteger(opts, 'daily-cap', integer)
      if (cap !== null && (cap < 100_000 || cap > 50_000_000)) throw new Error('--daily-cap must be 100000 to 50000000')
      return { fn: 'admin_set_tester_access', body: { p_user_id: required(opts, 'user', UUID), p_action: 'grant',
        p_days: days, p_daily_cap: cap, ...note() } }
    }
    case 'tester-revoke':
      return { fn: 'admin_set_tester_access', body: { p_user_id: required(opts, 'user', UUID), p_action: 'revoke',
        p_days: null, p_daily_cap: null, ...note() } }
    case 'tester-status':
      return { fn: 'admin_tester_status',
        body: { p_user_id: opts.user === undefined ? null : required(opts, 'user', UUID) } }
    default:
      return null
  }
}

module.exports = { isTesterCommand, assertTesterProject, testerCall }
