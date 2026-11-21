// Deterministic gates for the local Campus Bot review races. No database work runs until the opted-in test calls one.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')

/** Poll for an observed database state with a bounded wait. */
const until = async (predicate, label, timeoutMs = 10_000) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** Bind the helpers to the isolated test's guarded SQL connection. */
function createBoundaryTools({ sql, psql }) {
  // An interactive transaction lets the test commit a lock holder only after the other session really queued.
  async function holdTransaction(statement) {
    const child = spawn('docker', psql, { stdio: ['pipe', 'pipe', 'pipe'] })
    const marker = `ready-${randomUUID()}`
    let out = '', error = '', readyResolve, readyReject
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    const done = new Promise((resolve, reject) => {
      child.on('error', reject).on('close', code => code === 0 ? resolve() : reject(new Error(error)))
    })
    done.catch(readyReject)
    child.stdout.on('data', value => { out += value; if (out.includes(marker)) readyResolve() })
    child.stderr.on('data', value => { error += value })
    child.stdin.write(`set statement_timeout='30s'; set lock_timeout='30s'; begin; ${statement}; select '${marker}';\n`)
    await ready
    return { commit: async () => { child.stdin.end('commit;\n'); await done } }
  }
  const queued = tag => until(() => sql(`select count(*) from pg_stat_activity where wait_event_type='Lock'
    and query like '%${tag}%' and query not like '%pg_stat_activity%'`) !== '0', tag)

  // Test-only clones keep the installed admission body intact except a clock or one gated window lookup. The
  // deterministic clock exercises an old transaction crossing UTC midnight without a production clock override.
  function cloneAdmission(name, transform) {
    const definition = sql("select pg_get_functiondef('public.begin_ai_practice_generation(uuid,uuid,uuid,text[])'::regprocedure)")
    const changed = transform(definition)
    assert.notEqual(changed, definition, 'the installed boundary must be instrumented')
    sql(changed.replace('CREATE OR REPLACE FUNCTION public.begin_ai_practice_generation(', `CREATE OR REPLACE FUNCTION public.${name}(`)
      + `; revoke all on function public.${name}(uuid,uuid,uuid,text[]) from public,anon,authenticated,service_role;
         grant execute on function public.${name}(uuid,uuid,uuid,text[]) to service_role;`)
  }
  return { holdTransaction, queued, cloneAdmission }
}
module.exports = { createBoundaryTools, until }
