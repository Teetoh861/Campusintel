const { test } = require('node:test')
const assert = require('node:assert/strict')
const f = require('./database-fixture.cjs')
const opt = { skip:!f.enabled,timeout:30_000 }

test('all orientation tables are private and all entry points deny anon; definer functions have empty search paths',opt,() => {
  assert.equal(f.sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like 'orientation_%' and
    (not p.prosecdef or not exists(select 1 from unnest(p.proconfig) c where c in ('search_path=','search_path=""')))`),'0')
  assert.equal(f.sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'orientation_%' and has_function_privilege('anon',p.oid,'EXECUTE')`),'0')
  assert.equal(f.sql(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname like 'orientation_%' and c.relkind='r' and
    (not c.relrowsecurity or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'))`),'0')
})
test('students cannot invoke host state, commands or import, and cannot read another answer or an early key',opt,async () => f.fixture(async x => {
  assert.throws(() => f.call(x.players[0],`public.orientation_host_state('${x.event}')`),/Operator authorization required/)
  assert.throws(() => f.call(x.players[0],`public.orientation_host_command('${x.event}','lobby',null)`),/Operator authorization required/)
  assert.throws(() => f.call(x.players[0],`public.orientation_import('${crypto.randomUUID()}','{}')`),/Operator authorization required/)
  x.command('lobby',null,null,1); x.join(x.players[0]); x.join(x.players[1])
  assert.equal(x.poll(x.players[0]).question,null)
  const round = x.command('start').questionId; x.age(round,1)
  x.answer(x.players[0],round,0)
  const other = x.poll(x.players[1])
  assert.equal(other.question.selected,null); assert.equal(other.question.correct,null); assert.equal(other.question.gotIt,null)
  assert.equal(other.me.score,0); assert.ok(other.top.every(row => row.score === 0))
  assert.equal(other.question.number,1); assert.ok(!('questions' in other))
  assert.throws(() => f.sql(f.as(x.players[0],`(select to_jsonb(a) from private.orientation_answers a limit 1)`)),/permission denied/)
  x.age(round); assert.equal(x.poll(x.players[1]).question.correct,0)
}))
test('wrong PIN guesses are per-account and setup/revocation are rechecked inside the poll',opt,async () => f.fixture(async x => {
  x.command('lobby',null,null,1)
  for (let i = 0; i < 5; i++) assert.equal(f.call(x.players[0],`public.orientation_join('not-a-pin','Amara','Local')`).status,'wrong-pin')
  assert.equal(x.join(x.players[0]).status,'limited')
  assert.equal(x.join(x.players[1]).status,'ok')
  f.sql(`delete from auth.sessions where id='${x.players[1].session}'`)
  assert.throws(() => x.poll(x.players[1]),/Account session required/)
  f.sql(`update public.profiles set first_name=null where id='${x.players[2].user}'`)
  assert.throws(() => x.poll(x.players[2]),/Complete your profile/)
}))
test('separate imported events never share membership, questions, scores or claims; off blocks joining/answers',opt,async () => f.fixture(async x => {
  const event2 = crypto.randomUUID(), pack = require('../../scripts/orientation/fixtures.cjs').practicePack()
  try {
    f.call(x.host,`public.orientation_import('${event2}',${f.literal(JSON.stringify(pack))}::jsonb)`)
    x.command('lobby',null,null,1); x.join(x.players[0]); const round = x.command('start').questionId
    assert.equal(f.call(x.players[0],`public.orientation_poll('${event2}')`).status,'inactive')
    x.command('off',round)
    assert.equal(x.join(x.players[1]).status,'inactive')
    assert.equal(x.join(x.players[0]).me.name,x.players[0].name+' Local')
    assert.equal(x.answer(x.players[0],round,0).status,'closed')
  } finally { f.sql(`delete from private.orientation_events where id='${event2}'`) }
}))

test('only event staff or operators can look up codes; email assignment never grants a host role and revocation takes effect',opt,async () => f.fixture(async x => {
  x.command('lobby',null,null,1); x.join(x.players[0])
  const p = x.state().players[0].id
  // Result fixture for authorization only; the complete game exercises actual finalization and collection.
  f.sql(`update private.orientation_events set phase='ended',frozen_prizes=prizes where id='${x.event}';
    insert into private.orientation_winners(event_id,player_id,prize,prize_name) values('${x.event}','${p}',1,'Book voucher')`)
  const code = x.state().winners[0].code
  assert.throws(() => x.claim(x.players[0],code),/Event staff authorization required/)
  assert.deepEqual(f.call(x.staff,'public.orientation_staff_events()').events,[])
  x.command('staff-add',null,null,null,x.staff.email.toUpperCase())
  const added = x.command('staff-add',null,null,null,x.staff.email)
  assert.equal(added.staff.filter(s => s.userId === x.staff.user).length,1)
  assert.equal(f.sql(`select role from public.profiles where id='${x.staff.user}'`),'student')
  assert.equal(f.call(x.staff,'public.orientation_staff_events()').events[0].id,x.event)
  assert.equal(x.claim(x.staff,code.toLowerCase().match(/.{1,4}/g).join(' ')).winner.name,x.players[0].name+' Local')
  assert.equal(x.claim(x.host,code).winner.prize,'Book voucher')
  assert.throws(() => f.call(x.staff,`public.orientation_host_state('${x.event}')`),/Operator authorization required/)
  assert.throws(() => f.call(x.staff,`public.orientation_host_command('${x.event}','off',null)`),/Operator authorization required/)
  assert.throws(() => f.call(x.staff,`public.orientation_import('${crypto.randomUUID()}','{}')`),/Operator authorization required/)
  const other = crypto.randomUUID(), pack = require('../../scripts/orientation/fixtures.cjs').practicePack()
  try {
    f.call(x.host,`public.orientation_import('${other}',${f.literal(JSON.stringify(pack))}::jsonb)`)
    assert.throws(() => x.claim(x.staff,code,false,other),/Event staff authorization required/)
  } finally { f.sql(`delete from private.orientation_events where id='${other}'`) }
  x.command('staff-remove',null,x.staff.user)
  assert.throws(() => x.claim(x.staff,code,true),/Event staff authorization required/)
  assert.equal(x.claim(x.host,code).winner.collectedAt,null)
}))
