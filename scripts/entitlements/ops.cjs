#!/usr/bin/env node
// scripts/entitlements/ops.cjs — Operator tool for entitlements: status, recovery, the public launch and the free month.
// Explicit invocation only. Every change requires --actor and --reason and is written to the audit trail by the
// database function it calls. Students start their own free pass and claim their own free month (Early Access) on the
// site, so there is no operator command for either, and no list: the import, member and sweep commands are retired.
//   node scripts/entitlements/ops.cjs status --user <uuid>
//   node scripts/entitlements/ops.cjs grant --user <uuid> --days <n> --actor <name> --reason <text>
//   node scripts/entitlements/ops.cjs change-grant --grant <uuid> --action extend|revoke|restore|set-ai-units
//       [--until <ISO time>] [--units <n>] --actor <name> --reason <text>
//   node scripts/entitlements/ops.cjs early-access-report
//       The launch, when the claim closes (or would close if launch were activated now) and the months claimed.
//   node scripts/entitlements/ops.cjs configure-early-access [--planned-launch <ISO>] [--enrollment-days <n>]
//       --actor <name> --reason <text>
//       --enrollment-days is how long after launch a month can be claimed. It is fixed once the launch is recorded
//       (the closing instant is stored then): after launch a change is refused and nothing is changed.
//       --trial-after-early-access is retired (20261023120000): no account that has had Early Access gets a pass.
//   node scripts/entitlements/ops.cjs activate-launch --confirm-public-launch [--allow-short-claim-window]
//       --actor <name> --reason <text>
//       Records the ACTUAL public launch (once, now) and opens the claim. It enrols nobody. It prints when the claim
//       closes, and refuses a claim window shorter than the configured days unless --allow-short-claim-window is given.
//   node scripts/entitlements/ops.cjs purge-claims
//       Removes expired email claims (free pass and free month; past discovery_claim_retention, 5 years). pg_cron also
//       runs this daily (campusintell-discovery-claim-purge); the command is for an immediate purge.
//   node scripts/entitlements/ops.cjs claim-keys
//       Which ENTITLEMENT_CLAIM_HASH_KEYS versions live claims still reference, so a retired key is dropped safely.
//   node scripts/entitlements/ops.cjs selection-status | selection-change | calendar | term-set | term-extend ...
//       A student's course selection and the semester calendar: see scripts/entitlements/course-selection.cjs.
//   node scripts/entitlements/ops.cjs payment-status | payments-health | open-sales | close-sales | campus-bot-model |
//       campus-bot-cap | campus-bot-writer | campus-bot-refill | ai-limits | payment-verify | payment-fulfil | refund | refund-retry |
//       reconcile-now ...
//       Plan payments: see scripts/entitlements/payments.cjs and docs/payments-operations.md.
//   node scripts/entitlements/ops.cjs tester-grant | tester-revoke | tester-status ...
//       Owner tester access on the test site only: see scripts/entitlements/tester.cjs.
const { courseSelectionCall } = require('./course-selection.cjs')
const { courseAdditionCall } = require('./course-additions.cjs')
const { authAdminReader, paymentCommand } = require('./payments.cjs')
const { assertTesterProject, isTesterCommand, testerCall } = require('./tester.cjs')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REQUEST_TIMEOUT_MS = 30_000
// The list commands of the retired pre-launch Early Access list (PRD 4.9). Named so that a habit or an old runbook gets a
// clear answer instead of a usage line, and nothing is sent.
const RETIRED = new Set(['import-early-access', 'member', 'reconcile-early-access'])
const LAGOS_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric',
  month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

/** An instant the database returned, as the operator reads it. */
function lagos(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? String(iso) : `${LAGOS_TIME.format(date)} (Lagos)`
}

function options(args) {
  const parsed = { _: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) { parsed._.push(arg); continue }
    const name = arg.slice(2)
    if (['dry-run', 'confirm-public-launch', 'allow-short-claim-window', 'allow-empty', 'confirm', 'destination-confirmed',
      'everyone'].includes(name)) { parsed[name] = true; continue }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`)
    parsed[name] = value
    index += 1
  }
  return parsed
}

function required(opts, name, pattern) {
  const value = opts[name]
  if (typeof value !== 'string' || value.trim() === '' || (pattern && !pattern.test(value))) {
    throw new Error(`--${name} is required${pattern ? ' and must be valid' : ''}`)
  }
  return value.trim()
}

function integer(opts, name) {
  const value = Number(required(opts, name))
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer`)
  return value
}

function isoTime(value, name) {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${name} must be an ISO time`)
  return new Date(value).toISOString()
}

function connection(env, transport) {
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash) throw new Error('Entitlement tool configuration unavailable')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!local && url.protocol !== 'https:') throw new Error('Entitlement tool requires HTTPS')
  const key = env.SUPABASE_SECRET_KEY
  if (!key || key !== key.trim() || (!local && !/^sb_secret_[A-Za-z0-9_-]+$/.test(key))) {
    throw new Error('Entitlement tool configuration unavailable')
  }
  return async (fn, body, options) => {
    const response = await transport(new URL(`/rest/v1/rpc/${fn}`, url), {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { apikey: key, 'Content-Type': 'application/json',
        ...(!key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const code = payload && typeof payload.code === 'string' ? payload.code : String(response.status)
      // The database's own reason (for example "Semester dates refused: overlapping-semesters"), never row data.
      const message = payload && typeof payload.message === 'string' ? `: ${payload.message.slice(0, 200)}` : ''
      throw new Error(`${fn} refused (${code})${message}`)
    }
    return payload
  }
}

async function run(args, env = process.env, transport = fetch, write = text => process.stdout.write(text)) {
  const [command, ...rest] = args
  const opts = options(rest)
  const note = () => ({ p_actor: required(opts, 'actor'), p_reason: required(opts, 'reason') })
  const print = value => write(`${JSON.stringify(value, null, 2)}\n`)
  if (RETIRED.has(command)) {
    throw new Error(`${command} is retired: there is no Early Access list. Students claim their free month on the ` +
      'site; see docs/entitlements-operations.md')
  }
  // Tester commands refuse every project but the test one before the key is read or anything is sent.
  if (isTesterCommand(command)) assertTesterProject(env)
  const rpc = connection(env, transport)
  switch (command) {
    case 'status': return print(await rpc('admin_entitlement_status', { p_user_id: required(opts, 'user', UUID) }))
    case 'grant': return print(await rpc('admin_grant_access', { p_user_id: required(opts, 'user', UUID),
      p_days: integer(opts, 'days'), ...note() }))
    case 'change-grant': {
      const action = required(opts, 'action', /^(extend|revoke|restore|set-ai-units)$/)
      return print(await rpc('admin_change_grant', { p_grant_id: required(opts, 'grant', UUID), p_action: action,
        p_ends_at: action === 'extend' ? isoTime(required(opts, 'until'), '--until') : null,
        p_ai_units: action === 'set-ai-units' ? integer(opts, 'units') : null, ...note() }))
    }
    case 'early-access-report': return print(await rpc('admin_early_access_report', {}))
    case 'configure-early-access': {
      if (opts['trial-after-early-access'] !== undefined) {
        throw new Error('--trial-after-early-access is retired: no account that has had Early Access gets a Discovery Pass')
      }
      // Null leaves the retired setting as the migration pinned it (false).
      const configured = await rpc('admin_configure_early_access', {
        p_planned_launch_at: opts['planned-launch'] ? isoTime(opts['planned-launch'], '--planned-launch') : null,
        p_enrollment_days: opts['enrollment-days'] !== undefined ? integer(opts, 'enrollment-days') : null,
        p_trial_after_early_access: null, ...note() })
      if (configured.state === 'claim-window-fixed') {
        throw new Error(`NOT changed: the claim days are fixed once the launch is recorded; the free month claim closes on ` +
          `${lagos(configured.claim_closes_at)}`)
      }
      return print(configured)
    }
    case 'activate-launch': {
      // Irreversible: the launch is recorded once, and the claim opens at that instant.
      if (opts['confirm-public-launch'] !== true) throw new Error('activate-launch needs --confirm-public-launch')
      const launched = await rpc('admin_activate_public_launch', { ...note(),
        p_allow_short_window: opts['allow-short-claim-window'] === true })
      if (launched.state === 'short-claim-window') {
        // Nothing was recorded. The operator decides with the dates in front of them.
        throw new Error(`launch NOT recorded: the free month claim would close on ${lagos(launched.claim_would_close_at)}, ` +
          `less than ${launched.claim_days} days after launch (a full window needs launch by ` +
          `${lagos(launched.full_window_needs_launch_by)}). To launch anyway, add --allow-short-claim-window`)
      }
      // The two dates the operator needs, in Lagos time, ahead of the database's own answer.
      return print({ state: launched.state, launch_recorded: lagos(launched.actual_launch_at),
        claim_closes: lagos(launched.claim_closes_at), ...launched })
    }
    case 'purge-claims': return print({ removed: await rpc('purge_discovery_pass_claims', {}) })
    case 'claim-keys': return print(await rpc('admin_discovery_claim_keys', {}))
    default: {
      const tester = testerCall(command, opts, { required, integer, note })
      if (tester !== null) {
        const result = await rpc(tester.fn, tester.body)
        // The end the operator needs, in Lagos time, ahead of the database's own answer.
        return print(result && result.expires_at ? { ends: lagos(result.expires_at), ...result } : result)
      }
      const payment = paymentCommand(command, opts, { rpc, env, authAdmin: authAdminReader(env, transport),
        helpers: { required, integer, note } })
      if (payment !== null) return print(await payment())
      const call = courseAdditionCall(command, opts, { required, integer, note }) ??
        courseSelectionCall(command, opts, { required, integer, note })
      if (call === null) throw new Error('usage: see the header of scripts/entitlements/ops.cjs')
      return print(await rpc(call.fn, call.body))
    }
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).catch(error => {
    process.stderr.write(`entitlements: ${error instanceof Error ? error.message : 'failed'}\n`)
    process.exitCode = 1
  })
}

module.exports = { run }
