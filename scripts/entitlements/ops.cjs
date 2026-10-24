#!/usr/bin/env node
// scripts/entitlements/ops.cjs — Operator tool for entitlements: status, recovery and the trusted Early Access list.
// Explicit invocation only. Every change requires --actor and --reason and is written to the audit trail by the
// database function it calls. Early Access list phones are hashed here with ENTITLEMENT_PHONE_HASH_KEY and never
// sent; the Discovery Pass itself collects no phone number and has no operator command (students activate it).
//   node scripts/entitlements/ops.cjs status --user <uuid>
//   node scripts/entitlements/ops.cjs grant --user <uuid> --days <n> --actor <name> --reason <text>
//   node scripts/entitlements/ops.cjs change-grant --grant <uuid> --action extend|revoke|restore|set-ai-units
//       [--until <ISO time>] [--units <n>] --actor <name> --reason <text>
//   node scripts/entitlements/ops.cjs import-early-access --file <csv> --batch <label> --actor <name> [--dry-run]
//       CSV header: email,full_name,phone,joined_at  (phone may be empty; joined_at is an ISO time before launch)
//   node scripts/entitlements/ops.cjs member --email <email> --action exclude|include|mark-duplicate|clear-duplicate
//       [--of <email>] --actor <name> --reason <text>
//   node scripts/entitlements/ops.cjs early-access-report
//   node scripts/entitlements/ops.cjs configure-early-access [--planned-launch <ISO>] [--enrollment-days <n>]
//       --actor <name> --reason <text>
//       --trial-after-early-access is retired (20261023120000): no account that has had Early Access gets a pass.
//   node scripts/entitlements/ops.cjs activate-launch --confirm-public-launch --actor <name> --reason <text>
//       Records the ACTUAL public launch (once, now) and enrolls eligible confirmed accounts in bounded batches until
//       none remain.
//   node scripts/entitlements/ops.cjs reconcile-early-access --actor <name> --reason <text>
//   node scripts/entitlements/ops.cjs purge-claims
//       Removes expired Discovery Pass email claims (past discovery_claim_retention, 5 years). pg_cron also runs this
//       daily (campusintell-discovery-claim-purge); the command is for an immediate purge.
//   node scripts/entitlements/ops.cjs claim-keys
//       Which ENTITLEMENT_CLAIM_HASH_KEYS versions live claims still reference, so a retired key is dropped safely.
const fs = require('node:fs')
const { normalizeNigerianMobile, phoneHash } = require('../../lib/entitlements/phone.cjs')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REQUEST_TIMEOUT_MS = 30_000
const MIN_KEY_LENGTH = 32
const IMPORT_MAX_ROWS = 20_000
// Each sweep is one bounded transaction; the tool repeats them until nothing enrollable is left. A batch that grants
// nobody is retried only while it deferred accounts held by in-flight confirmations, which enroll themselves.
const SWEEP_BATCH = 200
const SWEEP_MAX_BATCHES = 500
const SWEEP_MAX_STALLED = 20
const SWEEP_RETRY_MS = 250

function options(args) {
  const parsed = { _: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) { parsed._.push(arg); continue }
    const name = arg.slice(2)
    if (name === 'dry-run' || name === 'confirm-public-launch') { parsed[name] = true; continue }
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

/** Minimal RFC 4180 reader: quoted fields, doubled quotes and CRLF. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field); rows.push(row); row = []; field = ''
    } else field += char
  }
  if (quoted) throw new Error('CSV has an unterminated quote')
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''))
}

/** Validate every row before anything is written; a bad file changes nothing. */
function readMembers(file, key) {
  const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
  const columns = (header ?? []).map(cell => cell.trim().toLowerCase())
  const expected = ['email', 'full_name', 'phone', 'joined_at']
  if (columns.join(',') !== expected.join(',')) throw new Error(`CSV header must be ${expected.join(',')}`)
  if (rows.length > IMPORT_MAX_ROWS) throw new Error(`CSV has more than ${IMPORT_MAX_ROWS} rows`)
  const seen = new Set()
  return rows.map((cells, index) => {
    const line = index + 2
    if (cells.length !== expected.length) throw new Error(`line ${line}: expected ${expected.length} columns`)
    const [email, fullName, phone, joinedAt] = cells.map(cell => cell.trim())
    const normalizedEmail = email.toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      throw new Error(`line ${line}: invalid email`)
    }
    if (seen.has(normalizedEmail)) throw new Error(`line ${line}: email repeated in this file`)
    seen.add(normalizedEmail)
    if (fullName === '' || fullName.length > 200) throw new Error(`line ${line}: full_name is required`)
    let hash = null
    if (phone !== '') {
      const normalized = normalizeNigerianMobile(phone)
      if (normalized === null) throw new Error(`line ${line}: phone is not a Nigerian mobile number`)
      if (key === null) throw new Error('ENTITLEMENT_PHONE_HASH_KEY is required to import phone numbers')
      hash = phoneHash(key, normalized.e164)
    }
    return { email: normalizedEmail, fullName, phoneHash: hash, joinedAt: isoTime(joinedAt, `line ${line}: joined_at`) }
  })
}

function phoneKey(env) {
  const key = env.ENTITLEMENT_PHONE_HASH_KEY
  return key !== undefined && key.trim().length >= MIN_KEY_LENGTH ? key : null
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
  return async (fn, body) => {
    const response = await transport(new URL(`/rest/v1/rpc/${fn}`, url), {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { apikey: key, 'Content-Type': 'application/json',
        ...(!key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const code = payload && typeof payload.code === 'string' ? payload.code : String(response.status)
      throw new Error(`${fn} refused (${code})`)
    }
    return payload
  }
}

/**
 * Repeat bounded sweeps until nothing enrollable remains. The database counts only accounts it would enroll, so a
 * batch that grants nobody and defers nobody means the sweep cannot finish: that, or running out of retries, is an
 * error naming what is left, never a quiet success.
 */
async function sweepAll(rpc, noteArgs, first, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let granted = first ? Number(first.granted) : 0
  let remaining = first ? Number(first.remaining) : Infinity
  let batches = first ? 1 : 0
  let stalled = 0
  while (remaining > 0 && batches < SWEEP_MAX_BATCHES) {
    const batch = await rpc('admin_reconcile_early_access', { ...noteArgs, p_limit: SWEEP_BATCH })
    batches += 1
    granted += Number(batch.granted)
    remaining = Number(batch.remaining)
    if (Number(batch.granted) > 0) { stalled = 0; continue }
    if (remaining === 0 || !(Number(batch.deferred) > 0) || ++stalled >= SWEEP_MAX_STALLED) break
    await pause(SWEEP_RETRY_MS)
  }
  const result = { granted, remaining: Number.isFinite(remaining) ? remaining : 0, batches }
  if (result.remaining > 0) {
    throw new Error(`sweep stopped with ${result.remaining} enrollable account(s) left after ${batches} batch(es) ` +
      `(${granted} granted); run reconcile-early-access again`)
  }
  return result
}

async function run(args, env = process.env, transport = fetch, write = text => process.stdout.write(text)) {
  const [command, ...rest] = args
  const opts = options(rest)
  const note = () => ({ p_actor: required(opts, 'actor'), p_reason: required(opts, 'reason') })
  const print = value => write(`${JSON.stringify(value, null, 2)}\n`)
  if (command === 'import-early-access') {
    const members = readMembers(required(opts, 'file'), phoneKey(env))
    const batch = required(opts, 'batch')
    const actor = required(opts, 'actor')
    if (opts['dry-run']) return print({ valid: members.length, withPhone: members.filter(m => m.phoneHash).length })
    const rpc = connection(env, transport)
    const counts = {}
    let deferred = 0
    for (const member of members) {
      const result = await rpc('admin_add_early_access_member', { p_email: member.email, p_full_name: member.fullName,
        p_phone_hash: member.phoneHash, p_joined_at: member.joinedAt, p_source: 'import', p_batch: batch, p_actor: actor })
      counts[result.state] = (counts[result.state] ?? 0) + 1
      if (result.enrollment === 'deferred') deferred += 1
    }
    if (deferred === 0) return print(counts)
    // An account that appeared mid-import was not enrolled inside it (that would invert the lock order); enroll it now
    // in fresh transactions.
    return print({ ...counts, deferred, sweep: await sweepAll(rpc, { p_actor: actor,
      p_reason: `import ${batch}: deferred enrollment` }, null) })
  }
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
    case 'member': {
      const action = required(opts, 'action', /^(exclude|include|mark-duplicate|clear-duplicate)$/)
      const changed = await rpc('admin_change_early_access_member', { p_email: required(opts, 'email'), p_action: action,
        p_other_email: action === 'mark-duplicate' ? required(opts, 'of') : null, ...note() })
      if (changed.enrollment !== 'deferred') return print(changed)
      // As for imports: an account that appeared mid-change is enrolled now, in fresh transactions.
      return print({ ...changed, sweep: await sweepAll(rpc, note(), null) })
    }
    case 'early-access-report': return print(await rpc('admin_early_access_report', {}))
    case 'configure-early-access': {
      if (opts['trial-after-early-access'] !== undefined) {
        throw new Error('--trial-after-early-access is retired: no account that has had Early Access gets a Discovery Pass')
      }
      // Null leaves the retired setting as the migration pinned it (false).
      return print(await rpc('admin_configure_early_access', {
        p_planned_launch_at: opts['planned-launch'] ? isoTime(opts['planned-launch'], '--planned-launch') : null,
        p_enrollment_days: opts['enrollment-days'] !== undefined ? integer(opts, 'enrollment-days') : null,
        p_trial_after_early_access: null, ...note() }))
    }
    case 'activate-launch': {
      // Irreversible: the launch is recorded once and every eligible month starts when its batch commits.
      if (opts['confirm-public-launch'] !== true) throw new Error('activate-launch needs --confirm-public-launch')
      const launched = await rpc('admin_activate_public_launch', { ...note(), p_limit: SWEEP_BATCH })
      if (launched.state !== 'launched') return print(launched)
      return print({ ...launched, ...await sweepAll(rpc, note(), launched) })
    }
    case 'reconcile-early-access': return print(await sweepAll(rpc, note(), null))
    case 'purge-claims': return print({ removed: await rpc('purge_discovery_pass_claims', {}) })
    case 'claim-keys': return print(await rpc('admin_discovery_claim_keys', {}))
    default: throw new Error('usage: see the header of scripts/entitlements/ops.cjs')
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).catch(error => {
    process.stderr.write(`entitlements: ${error instanceof Error ? error.message : 'failed'}\n`)
    process.exitCode = 1
  })
}

module.exports = { run, parseCsv, readMembers }
