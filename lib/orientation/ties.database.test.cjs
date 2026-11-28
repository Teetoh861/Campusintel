const { test }=require('node:test')
const assert=require('node:assert/strict')
const f=require('./database-fixture.cjs')
const opt={ skip:!f.enabled,timeout:60_000 }
const names=['Amara','Tobi','Chika','Seyi','Imani']

/** A frozen result fixture isolates prize resolution; the game suite separately exercises End and scoring. */
async function finished(prizes,totals,run){
  return f.fixture(async x=>{
    x.command('prizes',null,null,prizes);x.command('lobby');for(const person of x.players)x.join(person)
    const rows=x.state().players
    const players=x.players.map(person=>({ ...person,id:rows.find(row=>row.name===person.name+' Local').id }))
    const records=totals.map(([score,time],index)=>`('${x.event}','${players[index].id}',${score},${time},${1+totals.filter(([s,t])=>s>score||(s===score&&t<time)).length})`)
    f.sql(`update private.orientation_events set phase='ended',frozen_prizes=prizes,ended_at=clock_timestamp() where id='${x.event}';
      insert into private.orientation_final_scores(event_id,player_id,score,time_us,position) values ${records.join(',')};
      select private.orientation_finalize('${x.event}');`)
    await run({ ...x,players })
  },names.slice(0,totals.length))
}
function checkOrders(x,state){
  for(const group of state.draw.groups){
    assert.deepEqual([...group.order].sort(),[...group.candidates].sort())
    assert.equal(new Set(group.order).size,group.candidates.length)
    for(const [index,id] of group.order.entries()){
      const person=x.players.find(player=>player.id===id),own=x.poll(person)
      assert.equal(own.me.position,group.position+index)
      const winner=state.winners.find(row=>row.playerId===id)
      assert.equal(Boolean(own.me.claimCode),index<group.places)
      if(winner){assert.equal(winner.position,group.position+index);assert.equal(winner.prize,group.prizes[index]);assert.equal(own.me.prizePosition,winner.position);assert.equal(own.me.prize,winner.prize)}
    }
  }
}

test('an exact tie wholly inside the winners draws when the prizes differ, then preserves its recorded order',opt,async()=>finished(
  ['Backpack','Notebook'],[[5,2_000_000],[5,2_000_000],[3,1_000_000]],async x=>{
    const pending=x.state();assert.equal(pending.ties.needed,true);assert.equal(pending.ties.groups.length,1)
    const group=pending.ties.groups[0];assert.equal(group.position,1);assert.equal(group.places,2)
    assert.deepEqual(group.prizes,['Backpack','Notebook']);assert.deepEqual([...group.candidates].sort(),x.players.slice(0,2).map(p=>p.id).sort())
    assert.equal(pending.winners.length,0);assert.equal(x.poll(x.players[0]).drawPending,true)
    assert.throws(()=>f.call(x.players[0],`public.orientation_host_command('${x.event}','draw',null)`),/Operator authorization required/)
    const snapshot=f.sql(`select jsonb_agg(to_jsonb(s) order by player_id) from private.orientation_final_scores s where event_id='${x.event}'`)
    const drawn=x.command('draw'),replayed=x.command('draw');checkOrders(x,drawn)
    assert.equal(f.sql(`select jsonb_agg(to_jsonb(s) order by player_id) from private.orientation_final_scores s where event_id='${x.event}'`),snapshot,'the draw overlays positions without rewriting frozen results')
    assert.deepEqual(replayed.draw,drawn.draw);assert.deepEqual(replayed.winners,drawn.winners)
    assert.equal(drawn.draw.startedBy,x.host.user);assert.ok(drawn.draw.startedAt)
    assert.equal(f.sql(`select count(*) from private.orientation_draws where event_id='${x.event}'`),'1')
    x.command('staff-add',null,null,null,x.staff.email)
    for(const winner of drawn.winners){const receipt=x.claim(x.staff,winner.code);assert.equal(receipt.winner.position,winner.position);assert.equal(receipt.winner.prize,winner.prize)}
    assert.equal(x.command('prizes',null,null,['Changed','Changed']).status,'frozen')
    assert.equal(x.poll(x.players[2]).me.position,3)
  }))

test('tied winners receiving identical prizes finalize without a draw and share the same displayed position',opt,async()=>finished(
  ['Notebook','Notebook'],[[5,2_000_000],[5,2_000_000],[3,1_000_000]],async x=>{
    const state=x.state();assert.equal(state.ties,null);assert.equal(state.draw,null);assert.equal(state.winners.length,2)
    assert.equal(f.sql(`select count(*) from private.orientation_draws where event_id='${x.event}'`),'0')
    assert.equal(f.sql(`select winners_finalized from private.orientation_events where id='${x.event}'`),'t')
    x.command('staff-add',null,null,null,x.staff.email)
    for(const person of x.players.slice(0,2)){
      const own=x.poll(person),winner=state.winners.find(row=>row.playerId===person.id)
      assert.equal(own.me.position,1);assert.equal(own.me.prizePosition,1);assert.equal(winner.position,1)
      assert.equal(winner.prize,'Notebook');assert.equal(x.claim(x.staff,winner.code).winner.position,1)
    }
    const replay=x.command('draw');assert.equal(replay.draw,null);assert.deepEqual(replay.winners,state.winners)
  }))

test('a tie at the cut-off draws even when the winning places carry identical prizes',opt,async()=>finished(
  ['Notebook','Notebook'],[[4,1_000_000],[4,1_000_000],[4,1_000_000]],async x=>{
    const state=x.state(),group=state.ties.groups[0]
    assert.equal(group.position,1);assert.equal(group.places,2);assert.deepEqual(group.prizes,['Notebook','Notebook',null])
    const drawn=x.command('draw');assert.equal(drawn.winners.length,2);checkOrders(x,drawn)
    assert.equal(x.poll(x.players.find(player=>player.id===drawn.draw.groups[0].order[2])).me.claimCode,null)
  }))

test('ties below the prizes need no draw, and equal correct counts with different times remain ordered by time',opt,async()=>{
  await finished(['Voucher'],[[5,1_000_000],[0,0],[0,0]],async x=>{
    const state=x.state();assert.equal(state.draw,null);assert.equal(state.winners.length,1)
    assert.deepEqual(x.players.map(player=>x.poll(player).me.position),[1,2,2])
  })
  await finished(['Voucher','Notebook'],[[5,2_000_000],[5,1_000_000],[0,0]],async x=>{
    const state=x.state();assert.equal(state.draw,null);assert.equal(state.winners.length,2)
    assert.deepEqual(x.players.map(player=>x.poll(player).me.position),[2,1,3])
    assert.equal(state.winners[0].playerId,x.players[1].id)
  })
})

test('multiple internal and cut-off tie groups resolve atomically in one recorded concurrent host draw',opt,async()=>finished(
  ['Backpack','Voucher','Notebook','Notebook'],[[10,1_000_000],[10,1_000_000],[5,2_000_000],[5,2_000_000],[5,2_000_000]],async x=>{
    const pending=x.state();assert.equal(pending.ties.groups.length,2);assert.equal(pending.winners.length,0)
    assert.deepEqual(pending.ties.groups.map(group=>[group.position,group.candidates.length,group.places]),[[1,2,2],[3,3,2]])
    const release=await f.hold(`select 1 from private.orientation_events where id='${x.event}' for update`)
    let results
    try{
      const calls=Array.from({length:4},()=>f.background(f.as(x.host,`public.orientation_host_command('${x.event}','draw',null)`)))
      await new Promise(resolve=>setTimeout(resolve,100));await release();results=(await Promise.all(calls)).map(JSON.parse)
    }catch(error){await release();throw error}
    const first=results[0];assert.equal(first.winners.length,4);assert.equal(first.draw.groups.length,2);checkOrders(x,first)
    for(const result of results){assert.deepEqual(result.draw,first.draw);assert.deepEqual(result.winners,first.winners)}
    assert.equal(f.sql(`select count(*) from private.orientation_draws where event_id='${x.event}'`),'1')
    assert.equal(first.draw.startedBy,x.host.user);assert.ok(first.draw.startedAt)
    const again=x.command('draw');assert.deepEqual(again.draw,first.draw);assert.deepEqual(again.winners,first.winners)
    assert.equal(new Set(first.winners.map(winner=>winner.code)).size,4)
  }))
