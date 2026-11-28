// Explicitly opt in only after the shared Supabase stack has been released for this worktree.
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { practicePack } = require('../../scripts/orientation/fixtures.cjs')
const enabled = process.env.ORIENTATION_DB_TEST === '1'
const container = process.env.ORIENTATION_DB_CONTAINER || 'supabase_db_Campusintel'
const args = ['exec','-i',container,'psql','-U','postgres','-d','postgres','-XAtq','-v','ON_ERROR_STOP=1']
const literal = value => "'" + String(value).replaceAll("'","''") + "'"
function sql(statement) {
  assert.ok(enabled,'Shared stack access requires explicit ORIENTATION_DB_TEST=1')
  const result = spawnSync('docker',[...args,'-c',statement],{ encoding:'utf8',timeout:15_000 })
  assert.equal(result.status,0,result.stderr)
  return result.stdout.trim()
}
function background(statement) {
  assert.ok(enabled)
  const child = spawn('docker',[...args,'-c',statement],{ stdio:['ignore','pipe','pipe'] })
  let out = '',error = ''
  child.stdout.on('data',chunk => { out += chunk }); child.stderr.on('data',chunk => { error += chunk })
  return new Promise((resolve,reject) => { child.on('error',reject); child.on('close',code => code === 0 ? resolve(out.trim()) : reject(new Error(error))) })
}
function as(person,expression) {
  return `begin; set local role authenticated; set local request.jwt.claims = ${literal(JSON.stringify({ sub:person.user,session_id:person.session,role:'authenticated' }))}; select ${expression}; commit;`
}
const call = (person,expression) => JSON.parse(sql(as(person,`to_jsonb(${expression})`)))
async function hold(statement) {
  assert.ok(enabled)
  const child = spawn('docker',args,{ stdio:['pipe','pipe','pipe'] })
  let output = '', released = false
  const closed = new Promise(resolve => child.once('close',resolve))
  await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Local lock holder did not become ready')) },5_000)
    child.stdout.on('data',chunk => { output += chunk; if (output.includes('orientation-lock-ready')) { clearTimeout(timeout); resolve() } })
    child.on('error',reject)
    child.stdin.write(`begin; ${statement}; select 'orientation-lock-ready';\n`)
  })
  return async () => { if (!released) { released = true; child.stdin.end('commit;\n') } await closed }
}
async function fixture(run,playerNames = ['Amara','Tobi','Chika']) {
  const people = ['Host',...playerNames,'Staff'].map(name => { const user = randomUUID(); return { name,user,session:randomUUID(),email:'orientation-' + user + '@example.test' } })
  const host = people[0], players = people.slice(1,-1), staff = people[people.length - 1], event = randomUUID()
  try {
    for (const person of people) sql(`insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('${person.user}','${person.email}',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp());
      insert into auth.sessions(id,user_id,created_at,updated_at) values('${person.session}','${person.user}',clock_timestamp(),clock_timestamp());
      update public.profiles set first_name=${literal(person.name)},department_id='10000000-0000-4000-8000-000000000002',
        academic_level_id='20000000-0000-4000-8000-000000000001',academic_period_id='30000000-0000-4000-8000-000000000001' where id='${person.user}';`)
    sql(`update public.profiles set role='operator' where id='${host.user}'`)
    call(host,`public.orientation_import('${event}',${literal(JSON.stringify(practicePack()))}::jsonb)`)
    const rawCommand = (action,question = null,target = null,prizes = null,email = null) => call(host,
      `public.orientation_host_command('${event}',${literal(action)},${question ? literal(question) : 'null'},${target ? literal(target) : 'null'},${prizes === null ? 'null' : literal(JSON.stringify(prizes)) + '::jsonb'},${email === null ? 'null' : literal(email)})`)
    const command = (action,question = null,target = null,prizes = null,email = null) => {
      // Existing game fixtures request a count; it is realized as named prizes before opening the lobby.
      if (typeof prizes === 'number') { rawCommand('prizes',question,null,Array.from({ length:prizes },(_,i) => 'Prize ' + (i + 1))); prizes = null }
      return rawCommand(action,question,target,prizes,email)
    }
    const state = () => call(host,`public.orientation_host_state('${event}')`)
    const join = person => call(person,`public.orientation_join(${literal(state().pin)},${literal(person.name)},'Local')`)
    const poll = person => call(person,`public.orientation_poll('${event}')`)
    const answer = (person,question,option) => call(person,`public.orientation_answer('${event}','${question}',${option})`)
    const age = (question,seconds = 16) => sql(`update private.orientation_events set starts_at=least(starts_at,clock_timestamp()-interval '60 seconds') where id='${event}';
      with moment as materialized (select clock_timestamp() as at)
      update private.orientation_rounds set opens_at=moment.at-interval '${seconds} seconds',
      closes_at=moment.at+interval '${15 - seconds} seconds' from moment where id='${question}'`)
    const claim = (person,code,collect = false,selectedEvent = event) => call(person,`public.orientation_staff_claim('${selectedEvent}',${literal(code)},${collect})`)
    await run({ people,host,players,staff,event,command,state,join,poll,answer,age,claim })
  } finally {
    sql(`delete from private.orientation_events where id='${event}'; delete from auth.users where id in (${people.map(p => literal(p.user)).join(',')});`)
  }
}
module.exports = { enabled,sql,background,as,call,hold,fixture,literal }
