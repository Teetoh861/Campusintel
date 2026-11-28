-- One RPC per poll: PostgREST verifies the JWT and the function checks the live account and setup.
create function public.orientation_poll(p_event uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.orientation_player_account(); e private.orientation_events%rowtype;
  p private.orientation_players%rowtype; r private.orientation_rounds%rowtype;
  q private.orientation_questions%rowtype; a private.orientation_answers%rowtype;
  s record; now_at timestamptz; question jsonb := null; me jsonb := null;
begin
  if p_event is null then
    select x.* into e from private.orientation_events x
      left join private.orientation_players m on m.event_id = x.id and m.user_id = u
      where x.phase in ('lobby','live','ended')
      order by (x.phase in ('lobby','live')) desc, (x.kind = 'official') desc, (m.id is not null) desc, x.created_at desc limit 1 for share of x;
  else select * into e from private.orientation_events where id = p_event and phase <> 'draft' for share;
  end if;
  if e.id is null then return jsonb_build_object('status','inactive'); end if;
  select * into p from private.orientation_players where event_id = e.id and user_id = u;
  now_at := clock_timestamp();
  if p.id is null then
    if e.phase in ('off','ended') then return jsonb_build_object('status','inactive'); end if;
    return jsonb_build_object('status',case when e.phase in ('off','ended') then 'inactive' else 'join' end,
      'eventId',e.id,'title',e.title,'phase',e.phase,'firstName',(select first_name from public.profiles where id = u));
  end if;
  select * into r from private.orientation_rounds where id = e.current_round;
  if r.id is not null and not r.voided and e.phase <> 'off' and now_at >= e.starts_at then
    select * into q from private.orientation_questions where id = r.question_id;
    select * into a from private.orientation_answers where round_id = r.id and player_id = p.id;
    question := jsonb_build_object('id',r.id,'number',r.number,'prompt',q.prompt,'options',q.options,
      'opensAt',r.opens_at,'closesAt',r.closes_at,'selected',a.option,
      'answered',(select count(*) from private.orientation_answers where round_id = r.id),
      'correct',case when now_at >= r.closes_at then q.correct else null end,
      'gotIt',case when now_at >= r.closes_at then coalesce(a.option = q.correct,false) else null end);
  end if;
  select * into s from private.orientation_scores(e.id) where player_id = p.id;
  me := jsonb_build_object('name',p.first_name || ' ' || p.surname,'score',s.score,'position',s.position,
    'prize',(select prize_name from private.orientation_winners where event_id = e.id and player_id = p.id),
    'prizePosition',(select s.position from private.orientation_winners where event_id = e.id and player_id = p.id),
    'claimCode',(select claim_code from private.orientation_winners where event_id = e.id and player_id = p.id),
    'collected',(select collected_at is not null from private.orientation_winners where event_id = e.id and player_id = p.id));
  return jsonb_build_object('status','ok','eventId',e.id,'title',e.title,'kind',e.kind,'phase',e.phase,
    'serverNow',now_at,'startsAt',e.starts_at,'joined',(select count(*) from private.orientation_players where event_id = e.id),
    'question',question,'me',me,'top',private.orientation_leaders(e.id),
    'drawPending',e.phase = 'ended' and not e.winners_finalized);
end $$;

create function public.orientation_join(p_pin text, p_first_name text, p_surname text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.orientation_player_account(); e private.orientation_events%rowtype;
  pin_window private.orientation_pin_attempts%rowtype; at_time timestamptz;
begin
  at_time := clock_timestamp();
  select * into e from private.orientation_events where pin = p_pin and phase <> 'draft' for share;
  if e.id is not null and exists(select 1 from private.orientation_players where event_id = e.id and user_id = u) then
    return public.orientation_poll(e.id);
  end if;
  insert into private.orientation_pin_attempts values(u,at_time,0) on conflict do nothing;
  select * into pin_window from private.orientation_pin_attempts where user_id = u for update;
  if pin_window.window_start <= at_time - interval '5 minutes' then
    update private.orientation_pin_attempts set window_start = at_time, attempts = 0 where user_id = u;
    pin_window.attempts := 0;
  end if;
  if pin_window.attempts >= 5 then return jsonb_build_object('status','limited'); end if;
  if e.id is null then
    update private.orientation_pin_attempts set attempts = attempts + 1 where user_id = u;
    return jsonb_build_object('status','wrong-pin');
  end if;
  if e.phase not in ('lobby','live') then return jsonb_build_object('status','inactive'); end if;
  if p_first_name is null or p_surname is null or char_length(btrim(p_first_name)) not between 1 and 80
    or char_length(btrim(p_surname)) not between 1 and 80
    or (p_first_name || p_surname) ~ '[[:cntrl:]]' then return jsonb_build_object('status','invalid'); end if;
  insert into private.orientation_players(event_id,user_id,first_name,surname)
    values(e.id,u,btrim(p_first_name),btrim(p_surname)) on conflict(event_id,user_id) do nothing;
  return public.orientation_poll(e.id);
end $$;

create function public.orientation_answer(p_event uuid, p_question uuid, p_option integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.orientation_player_account(); e private.orientation_events%rowtype;
  p private.orientation_players%rowtype; r private.orientation_rounds%rowtype;
  a private.orientation_answers%rowtype; accepted timestamptz; option_count integer;
begin
  -- Shared event/round locks permit concurrent players, but serialize against host transitions.
  select * into e from private.orientation_events where id = p_event for share;
  select * into r from private.orientation_rounds where event_id = p_event and id = p_question for share;
  select * into p from private.orientation_players where event_id = p_event and user_id = u for update;
  if p.id is null or r.id is null then return jsonb_build_object('status','not-joined'); end if;
  -- Resolve an acknowledged or lost-response retry before testing the current deadline/phase.
  select * into a from private.orientation_answers where round_id = r.id and player_id = p.id;
  if a.round_id is not null then return jsonb_build_object('status','locked','selected',a.option); end if;
  accepted := clock_timestamp();
  if e.phase <> 'live' or e.current_round <> r.id or r.voided or not private.orientation_is_open(accepted,r.opens_at,r.closes_at) then
    return jsonb_build_object('status','closed');
  end if;
  select jsonb_array_length(options) into option_count from private.orientation_questions where id = r.question_id;
  if p_option is null or p_option < 0 or p_option >= option_count then return jsonb_build_object('status','invalid'); end if;
  insert into private.orientation_answers(event_id,round_id,player_id,option,accepted_at,elapsed_us)
    values(e.id,r.id,p.id,p_option,accepted,(extract(epoch from accepted - r.opens_at) * 1000000)::bigint);
  return jsonb_build_object('status','locked','selected',p_option);
end $$;

revoke all on function public.orientation_poll(uuid), public.orientation_join(text,text,text),
  public.orientation_answer(uuid,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.orientation_poll(uuid), public.orientation_join(text,text,text),
  public.orientation_answer(uuid,uuid,integer) to authenticated;
