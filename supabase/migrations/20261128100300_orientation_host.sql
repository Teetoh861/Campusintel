-- Host-only projections and commands. Every call checks the current database-owned operator role.
create function public.orientation_host_state(p_event uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_live_operator(); e private.orientation_events%rowtype;
  r private.orientation_rounds%rowtype; roster jsonb; questions jsonb;
begin
  if p_event is null then select * into e from private.orientation_events order by created_at desc limit 1 for share;
  else select * into e from private.orientation_events where id = p_event for share; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'kind',kind,'phase',phase) order by created_at desc),'[]'::jsonb)
    into roster from private.orientation_events;
  if e.id is null then return jsonb_build_object('status','empty','events',roster); end if;
  select * into r from private.orientation_rounds where id = e.current_round;
  select jsonb_agg(jsonb_build_object('id',id,'ordinal',ordinal,'category',category,'spare',spare,
    'prompt',prompt,'options',options,'correct',correct,'current',coalesce(id = r.question_id,false),
    'used',exists(select 1 from private.orientation_rounds x where x.question_id = q.id)) order by ordinal)
    into questions from private.orientation_questions q where event_id = e.id;
  return jsonb_build_object('status','ok','events',roster,'eventId',e.id,'title',e.title,'kind',e.kind,
    'phase',e.phase,'pin',e.pin,'prizes',e.prizes,'winnerCount',e.winner_count,'startsAt',e.starts_at,'serverNow',clock_timestamp(),
    'questionId',r.id,'number',r.number,'opensAt',r.opens_at,'closesAt',r.closes_at,
    'questions',questions,'answered',(select count(*) from private.orientation_answers where round_id = r.id),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.first_name || ' ' || p.surname,
      'hidden',p.hidden,'score',s.score,'position',s.position,'timeUs',s.time_us) order by s.position,p.id),'[]'::jsonb)
      from private.orientation_players p join private.orientation_scores(e.id) s on s.player_id = p.id where p.event_id = e.id),
    'ties',case when e.phase = 'ended' and not e.winners_finalized then private.orientation_ties(e.id) else null end,
    'draw',(select jsonb_build_object('startedBy',started_by,'startedAt',started_at,'groups',groups)
      from private.orientation_draws where event_id = e.id),
    'staff',(select coalesce(jsonb_agg(jsonb_build_object('userId',u.id,'email',u.email) order by u.email),'[]'::jsonb)
      from private.orientation_staff m join auth.users u on u.id = m.user_id where m.event_id = e.id),
    'winners',(select coalesce(jsonb_agg(jsonb_build_object('playerId',w.player_id,'position',s.position,'prize',w.prize_name,
      'name',p.first_name || ' ' || p.surname,'code',w.claim_code,'collectedAt',w.collected_at) order by w.prize),'[]'::jsonb)
      from private.orientation_winners w join private.orientation_players p on p.id = w.player_id
      join private.orientation_scores(e.id) s on s.player_id = w.player_id where w.event_id = e.id));
end $$;

create function public.orientation_host_command(p_event uuid, p_action text, p_question uuid,
  p_target uuid default null, p_prizes jsonb default null, p_email text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_live_operator(); e private.orientation_events%rowtype;
  r private.orientation_rounds%rowtype; next_q uuid; next_round uuid; next_number integer; staff_user uuid;
  pin_candidate text; at_time timestamptz; opening timestamptz;
begin
  select * into e from private.orientation_events where id = p_event for update;
  if e.id is null then return jsonb_build_object('status','missing'); end if;
  select * into r from private.orientation_rounds where id = e.current_round for update;
  if p_action in ('start','next','skip','end') and p_question is distinct from e.current_round then
    return jsonb_build_object('status','stale');
  end if;
  if p_action = 'lobby' then
    if e.phase <> 'draft' then return public.orientation_host_state(e.id); end if;
    -- Retry collision rather than failing while opening the hall.
    loop
      pin_candidate := lpad((('x' || substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 1000000)::text,6,'0');
      begin
        update private.orientation_events set phase = 'lobby',pin = pin_candidate where id = e.id;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
  elsif p_action in ('start','next','skip') then
    if p_action = 'start' then
      if e.phase = 'live' then return public.orientation_host_state(e.id); end if;
      if e.phase <> 'lobby' then return jsonb_build_object('status','invalid'); end if;
      if e.winner_count < 1 then return jsonb_build_object('status','prizes-required'); end if;
      if (select count(*) from private.orientation_players where event_id = e.id) < e.winner_count then
        return jsonb_build_object('status','too-few-players');
      end if;
      next_number := 1;
    else
      if e.phase <> 'live' or r.id is null then return jsonb_build_object('status','invalid'); end if;
      if p_action = 'next' and clock_timestamp() < r.closes_at then return jsonb_build_object('status','still-open'); end if;
      next_number := r.number + case when p_action = 'skip' then 0 else 1 end;
      if next_number > 15 then return jsonb_build_object('status','finish'); end if;
    end if;
    if p_action = 'skip' then
      select q.id into next_q from private.orientation_questions q where q.event_id = e.id and q.spare
        and not exists(select 1 from private.orientation_rounds x where x.question_id = q.id)
        order by q.ordinal limit 1;
      if next_q is null then return jsonb_build_object('status','no-spare'); end if;
      update private.orientation_rounds set voided = true where id = r.id;
    else
      select q.id into next_q from private.orientation_questions q where q.event_id = e.id and not q.spare
        and q.ordinal = next_number;
    end if;
    if next_q is null then return jsonb_build_object('status','invalid'); end if;
    at_time := clock_timestamp();
    if p_action = 'start' then
      e.starts_at := at_time + interval '10 seconds';
      update private.orientation_events set started_at = at_time,starts_at = e.starts_at where id = e.id;
    end if;
    opening := greatest(at_time,e.starts_at) + interval '4 seconds';
    insert into private.orientation_rounds(event_id,question_id,number,opens_at,closes_at)
      values(e.id,next_q,next_number,opening,opening + interval '15 seconds') returning id into next_round;
    update private.orientation_events set phase = 'live',current_round = next_round where id = e.id;
  elsif p_action = 'prizes' then
    if e.phase not in ('draft','lobby','live') then return jsonb_build_object('status','frozen'); end if;
    if not private.orientation_valid_prizes(p_prizes) then return jsonb_build_object('status','invalid'); end if;
    if e.phase = 'live' and jsonb_array_length(p_prizes) < 1 then return jsonb_build_object('status','prizes-required'); end if;
    if e.phase = 'live' and jsonb_array_length(p_prizes) >
      (select count(*) from private.orientation_players where event_id = e.id) then
      return jsonb_build_object('status','too-few-players');
    end if;
    update private.orientation_events set prizes = p_prizes where id = e.id;
  elsif p_action = 'staff-add' then
    if p_email is null or char_length(p_email) > 254 then return jsonb_build_object('status','invalid'); end if;
    select u.id into staff_user from auth.users u where lower(u.email) = lower(btrim(p_email))
      and u.email_confirmed_at is not null;
    if staff_user is null then return jsonb_build_object('status','staff-missing'); end if;
    insert into private.orientation_staff(event_id,user_id,added_by) values(e.id,staff_user,actor) on conflict do nothing;
  elsif p_action = 'staff-remove' then
    delete from private.orientation_staff where event_id = e.id and user_id = p_target;
  elsif p_action = 'hide' then
    update private.orientation_players set hidden = true where event_id = e.id and id = p_target;
    if not found then return jsonb_build_object('status','missing'); end if;
  elsif p_action = 'end' then
    if e.phase = 'ended' then return public.orientation_host_state(e.id); end if;
    if e.phase <> 'live' or r.number <> 15 or clock_timestamp() < r.closes_at then
      return jsonb_build_object('status','not-finished');
    end if;
    insert into private.orientation_final_scores(event_id,player_id,score,time_us,position)
      select e.id,s.* from private.orientation_standings(e.id) s;
    update private.orientation_events set phase = 'ended',ended_at = clock_timestamp(),frozen_prizes = prizes where id = e.id;
    perform private.orientation_finalize(e.id);
  elsif p_action = 'draw' then
    if e.phase <> 'ended' then return jsonb_build_object('status','invalid'); end if;
    perform private.orientation_finalize(e.id,true);
  elsif p_action = 'collect' then
    update private.orientation_winners set collected_at = clock_timestamp(),collected_by = actor
      where event_id = e.id and player_id = p_target and collected_at is null;
    -- Existing collection remains authoritative; no new receipt/code is generated on replay.
  elsif p_action = 'off' then
    update private.orientation_events set phase = 'off' where id = e.id;
  else return jsonb_build_object('status','invalid');
  end if;
  return public.orientation_host_state(e.id);
end $$;

revoke all on function public.orientation_host_state(uuid), public.orientation_host_command(uuid,text,uuid,uuid,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.orientation_host_state(uuid), public.orientation_host_command(uuid,text,uuid,uuid,jsonb,text)
  to authenticated;
