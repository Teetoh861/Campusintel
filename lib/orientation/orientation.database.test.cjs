const { test } = require('node:test')
const assert = require('node:assert/strict')
const f = require('./database-fixture.cjs')
const opt = { skip:!f.enabled,timeout:60_000 }

test('database admission predicate includes 14.9 seconds and excludes exact close and later',opt,() => {
  for (const [seconds,expected] of [[-0.001,false],[0,true],[14.9,true],[15,false],[15.001,false]]) {
    assert.equal(f.sql(`select private.orientation_is_open('2026-12-07 10:00:00+00'::timestamptz+interval '${seconds} seconds',
      '2026-12-07 10:00:00+00','2026-12-07 10:00:15+00')`),expected ? 't' : 'f')
  }
})
test('actual admission rejects ready/late answers; concurrent taps and lost replies keep the first choice',opt,async () => f.fixture(async x => {
  x.command('lobby',null,null,1); x.join(x.players[0]); const round = x.command('start').questionId
  assert.equal(x.answer(x.players[0],round,0).status,'closed')
  x.age(round,1)
  const release = await f.hold(`select 1 from private.orientation_players where event_id='${x.event}' for update`)
  let results
  try {
    const races = Array.from({ length:8 },(_,i) => f.background(f.as(x.players[0],`public.orientation_answer('${x.event}','${round}',${i % 2})`)))
    await new Promise(resolve => setTimeout(resolve,100)); await release(); results = (await Promise.all(races)).map(JSON.parse)
  } catch (error) { await release(); throw error }
  assert.ok(results.every(value => value.status === 'locked' && value.selected === results[0].selected))
  assert.equal(f.sql(`select count(*) from private.orientation_answers where event_id='${x.event}'`),'1')
  x.age(round,16)
  assert.deepEqual(x.answer(x.players[0],round,1 - results[0].selected),results[0])
  x.join(x.players[1]); assert.equal(x.answer(x.players[1],round,0).status,'closed')
}))
test('an answer queued before close cannot use transaction-start time after its final lock',opt,async () => f.fixture(async x => {
  x.command('lobby',null,null,1); x.join(x.players[0]); const round = x.command('start').questionId; x.age(round,14)
  const release = await f.hold(`select 1 from private.orientation_players where event_id='${x.event}' for update`)
  const answer = f.background(f.as(x.players[0],`public.orientation_answer('${x.event}','${round}',0)`))
  await new Promise(resolve => setTimeout(resolve,1_200)); await release()
  assert.equal(JSON.parse(await answer).status,'closed')
  assert.equal(f.sql(`select count(*) from private.orientation_answers where event_id='${x.event}'`),'0')
}))
test('Next and Skip name their question, racing taps move only once; independent spares, hiding and late joins stay correct',opt,async () => f.fixture(async x => {
  assert.ok(x.state().questions.every(question => question.current === false))
  const lobby = x.command('lobby',null,null,1)
  assert.ok(lobby.questions.every(question => question.current === false))
  x.join(x.players[0]); const first = x.command('start').questionId; x.age(first)
  const next = await Promise.all(Array.from({ length:2 },() => f.background(f.as(x.host,
    `public.orientation_host_command('${x.event}','next','${first}')`))))
  assert.deepEqual(next.map(value => JSON.parse(value).status).sort(),['ok','stale'])
  const second = x.state().questionId
  const skipped = await Promise.all(Array.from({ length:2 },() => f.background(f.as(x.host,
    `public.orientation_host_command('${x.event}','skip','${second}')`))))
  assert.deepEqual(skipped.map(value => JSON.parse(value).status).sort(),['ok','stale'])
  const state = x.state(); assert.equal(state.number,2)
  assert.equal(state.questions.find(q => q.current).spare,true)
  assert.equal(state.questions.find(q => q.current).category,'general')
  const late = x.join(x.players[1]); assert.equal(late.question.id,state.questionId); assert.equal(late.me.score,0)
  const id = state.players.find(p => p.name.startsWith(x.players[0].name)).id
  x.command('hide',state.questionId,id)
  assert.ok(x.poll(x.players[1]).top.some(p => p.name === 'Name hidden'))
  assert.equal(f.sql(`select count(*) from private.orientation_rounds where event_id='${x.event}' and not voided`),'2')
}))
test('correct answers only determine elapsed time; final cutoff draw and collection happen once',opt,async () => f.fixture(async x => {
  x.command('lobby',null,null,2); x.join(x.players[0]); x.join(x.players[1]); let state = x.command('start')
  const scores = [0,0,0]
  for (let number = 1; number <= 15; number++) {
    const round = state.questionId; x.age(round,1)
    if (number === 7) assert.equal(x.command('prizes',round,null,['Backpack','Notebook']).status,'ok')
    if (number === 2) x.join(x.players[2])
    for (let i = 0; i < x.players.length; i++) {
      if (i === 2 && number === 1) continue
      const option = i === 0 && number % 2 ? 0 : 1
      x.answer(x.players[i],round,option); if (option === 0) scores[i]++
    }
    x.age(round)
    const a = x.poll(x.players[0]); assert.equal(a.question.correct,0); assert.equal(a.me.score,scores[0])
    state = number === 15 ? x.command('end',round) : x.command('next',round)
  }
  assert.deepEqual(scores,[8,0,0]); assert.equal(state.ties.needed,true)
  assert.equal(x.command('prizes',state.questionId,null,['Changed']).status,'frozen')
  assert.deepEqual(JSON.parse(f.sql(`select frozen_prizes from private.orientation_events where id='${x.event}'`)),['Backpack','Notebook'])
  const first = state.players.find(p => p.name.startsWith(x.players[0].name))
  assert.equal(first.position,1)
  for (const other of state.players.filter(p => p.id !== first.id)) { assert.equal(other.position,2); assert.equal(other.timeUs,0) }
  assert.equal(state.winners.length,0)
  const drawn = x.command('draw',state.questionId), replayed = x.command('draw',state.questionId)
  assert.equal(drawn.winners.length,2); assert.deepEqual(replayed.draw,drawn.draw); assert.deepEqual(replayed.winners,drawn.winners)
  assert.equal(f.sql(`select count(*) from private.orientation_draws where event_id='${x.event}'`),'1')
  assert.equal(drawn.draw.startedBy,x.host.user)
  for (const person of x.players) {
    const own = x.poll(person), winner = drawn.winners.find(w => w.name.startsWith(person.name))
    const player = drawn.players.find(row => row.name === person.name+' Local')
    const order = drawn.draw.groups[0].order
    assert.equal(own.me.position,player.id === first.id ? 1 : 2+order.indexOf(player.id))
    assert.equal(own.me.score,player.id === first.id ? 8 : 0)
    assert.equal(Boolean(own.me.claimCode),Boolean(winner))
    if (winner) { assert.equal(own.me.claimCode,winner.code); assert.equal(own.me.prize,winner.position === 1 ? 'Backpack' : 'Notebook'); assert.equal(own.me.prizePosition,winner.position) }
    assert.ok(!JSON.stringify(own.top).includes('claimCode'))
  }
  const winner = drawn.winners[0]
  const calls = await Promise.all(Array.from({ length:2 },() => f.background(f.as(x.host,
    `public.orientation_host_command('${x.event}','collect','${state.questionId}','${winner.playerId}')`))))
  const collected = calls.map(value => JSON.parse(value).winners.find(w => w.playerId === winner.playerId).collectedAt)
  assert.equal(collected[0],collected[1]); assert.ok(collected[0])
  x.command('staff-add',state.questionId,null,null,x.staff.email)
  const staffWinner = drawn.winners[1]
  assert.equal(x.claim(x.staff,'definitely-wrong').status,'missing')
  const checked = x.claim(x.staff,staffWinner.code)
  assert.deepEqual(checked.winner,{ name:staffWinner.name,position:staffWinner.position,prize:staffWinner.prize,collectedAt:null })
  const claims = await Promise.all(Array.from({ length:2 },() => f.background(f.as(x.staff,
    `public.orientation_staff_claim('${x.event}','${staffWinner.code}',true)`))))
  const receipts = claims.map(value => JSON.parse(value).winner.collectedAt)
  assert.ok(receipts[0]); assert.equal(receipts[0],receipts[1])
  x.command('collect',state.questionId,staffWinner.playerId)
  assert.equal(f.sql(`select collected_by from private.orientation_winners where event_id='${x.event}' and player_id='${staffWinner.playerId}'`),x.staff.user)
  assert.equal(x.claim(x.staff,staffWinner.code).winner.collectedAt,receipts[0])
}))
test('equal correct counts rank by correct-answer time, ignoring even very slow wrong answers',opt,async () => f.fixture(async x => {
  x.command('lobby',null,null,1); x.join(x.players[0]); x.join(x.players[1]); const round = x.command('start').questionId
  x.age(round,1); x.answer(x.players[0],round,0); x.answer(x.players[1],round,0)
  // Explicit result fixture: the admission path is tested separately, and these exact times prove the ordering.
  f.sql(`update private.orientation_answers a set elapsed_us=case when p.user_id='${x.players[0].user}' then 2000000 else 1000000 end
    from private.orientation_players p where p.id=a.player_id and a.event_id='${x.event}'`)
  x.age(round)
  assert.equal(x.poll(x.players[0]).me.position,2); assert.equal(x.poll(x.players[1]).me.position,1)
}))

test('Start inserts ten seconds before first get-ready, exposes no question in that countdown, and is replay-safe',opt,async () => f.fixture(async x => {
  x.command('lobby'); x.join(x.players[0])
  assert.equal(x.command('start').status,'prizes-required')
  x.command('prizes',null,null,['Book voucher'])
  const started = x.command('start')
  const state = x.poll(x.players[0])
  assert.equal(state.question,null); assert.equal(state.phase,'live'); assert.ok(state.startsAt)
  assert.equal(Date.parse(started.opensAt)-Date.parse(started.startsAt),4_000)
  assert.equal(Date.parse(started.closesAt)-Date.parse(started.startsAt),19_000)
  assert.equal(Number(f.sql(`select extract(epoch from starts_at-started_at) from private.orientation_events where id='${x.event}'`)),10)
  const retried = x.command('start'); assert.equal(retried.status,'stale')
  assert.equal(x.state().startsAt,started.startsAt)
  const skipped = x.command('skip',started.questionId)
  assert.equal(skipped.startsAt,started.startsAt); assert.ok(Date.parse(skipped.opensAt) >= Date.parse(started.opensAt))
  x.age(skipped.questionId,-1)
  const ready = x.poll(x.players[0]); assert.ok(ready.question); assert.equal(ready.question.correct,null)
  assert.equal(x.answer(x.players[0],skipped.questionId,0).status,'closed')
}))
