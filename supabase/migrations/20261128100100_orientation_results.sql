-- Shared authority and result projections; every relation/function is schema-qualified.
create function private.orientation_is_open(p_now timestamptz, p_opens timestamptz, p_closes timestamptz)
returns boolean language sql immutable security definer set search_path = '' as $$
  select p_opens <= p_now and p_now < p_closes;
$$;
create function private.orientation_player_account() returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.require_live_account();
begin
  if not exists (select 1 from public.profiles where id = u and first_name is not null
    and department_id is not null and academic_level_id is not null and academic_period_id is not null
    and selection_confirmed_at is not null) then
    raise exception 'Complete your profile to join.' using errcode = '42501';
  end if;
  return u;
end $$;

create function private.orientation_standings(p_event uuid)
returns table(player_id uuid, score integer, time_us bigint, "position" integer)
language sql security definer set search_path = '' as $$
  with totals as (
    select p.id, count(a.round_id) filter (where a.option = q.correct)::integer as score,
      coalesce(sum(a.elapsed_us) filter (where a.option = q.correct), 0)::bigint as time_us
    from private.orientation_players p
    left join private.orientation_rounds r on r.event_id = p.event_id and not r.voided and r.closes_at <= clock_timestamp()
    left join private.orientation_questions q on q.id = r.question_id
    left join private.orientation_answers a on a.round_id = r.id and a.player_id = p.id
    where p.event_id = p_event group by p.id
  )
  select id, totals.score, totals.time_us, rank() over (order by totals.score desc, totals.time_us)::integer from totals;
$$;

create function private.orientation_scores(p_event uuid)
returns table(player_id uuid, score integer, time_us bigint, "position" integer)
language sql security definer set search_path = '' as $$
  with drawn as (
    select player.value::uuid as player_id,
      ((g.value->>'position')::integer + player.ordinality - 1)::integer as position
    from private.orientation_draws d cross join lateral jsonb_array_elements(d.groups) g
    cross join lateral jsonb_array_elements_text(g.value->'order') with ordinality player(value,ordinality)
    where d.event_id = p_event
  )
  select s.player_id, s.score, s.time_us, coalesce(d.position,s.position)
    from private.orientation_final_scores s left join drawn d on d.player_id = s.player_id where s.event_id = p_event
  union all
  select s.* from private.orientation_standings(p_event) s
    where not exists (select 1 from private.orientation_final_scores f where f.event_id = p_event);
$$;

create function private.orientation_leaders(p_event uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.row order by x.position, x.player_id), '[]'::jsonb) from (
    select s.player_id, s.position, jsonb_build_object('position', s.position, 'score', s.score,
      'name', case when p.hidden then 'Name hidden' else p.first_name || ' ' || p.surname end) as row
    from private.orientation_scores(p_event) s join private.orientation_players p on p.id = s.player_id
    order by s.position, s.player_id limit 5
  ) x;
$$;

-- A tie matters only when its slots have different prizes, including a slot with no prize.
create function private.orientation_ties(p_event uuid) returns jsonb
language sql security definer set search_path = '' as $$
  with slots as (
    select s.player_id,s.score,s.time_us,
      row_number() over (order by s.score desc,s.time_us,s.player_id)::integer as place,
      e.winner_count,e.frozen_prizes
    from private.orientation_final_scores s join private.orientation_events e on e.id = s.event_id
    where s.event_id = p_event
  ), grouped as (
    select min(place) as position,array_agg(player_id order by player_id) as candidates,
      count(*) filter (where place <= winner_count)::integer as places,
      jsonb_agg(case when place <= winner_count then frozen_prizes->(place - 1) else 'null'::jsonb end order by place) as prizes
    from slots group by score,time_us
    having count(*) > 1 and count(*) filter (where place <= winner_count) > 0
      and count(distinct coalesce(frozen_prizes->(place - 1),'null'::jsonb)) > 1
  ), plan as (
    select coalesce(jsonb_agg(jsonb_build_object('position',position,'candidates',candidates,
      'places',places,'prizes',prizes) order by position),'[]'::jsonb) as groups from grouped
  ) select jsonb_build_object('needed',jsonb_array_length(groups) > 0,'groups',groups) from plan;
$$;

create function private.orientation_finalize(p_event uuid, p_draw boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare e private.orientation_events%rowtype; plan jsonb; g jsonb; drawn jsonb := '[]'::jsonb;
  ordered uuid[]; actor uuid;
begin
  select * into e from private.orientation_events where id = p_event for update;
  if e.phase <> 'ended' or e.winners_finalized then return; end if;
  plan := private.orientation_ties(p_event);
  if (plan->>'needed')::boolean then
    if not p_draw then return; end if;
    actor := private.require_live_operator();
    for g in select value from jsonb_array_elements(plan->'groups') loop
      -- One random key per candidate; freeze the complete order, including any non-winners.
      select array_agg(candidate order by lottery,candidate) into ordered from (
        select value::uuid as candidate,gen_random_uuid() as lottery
        from jsonb_array_elements_text(g->'candidates')
      ) shuffled;
      drawn := drawn || jsonb_build_array(g || jsonb_build_object('order',ordered));
    end loop;
    insert into private.orientation_draws(event_id,started_by,groups) values(p_event,actor,drawn);
  end if;
  insert into private.orientation_winners(event_id,player_id,prize,prize_name)
    select p_event,ranked.player_id,ranked.place::integer,e.frozen_prizes->>(ranked.place::integer - 1)
    from (
      select s.player_id,row_number() over (order by s.position,s.player_id) as place
      from private.orientation_scores(p_event) s order by s.position,s.player_id limit e.winner_count
    ) ranked;
  update private.orientation_events set winners_finalized = true where id = p_event;
end $$;

-- Private helpers are callable only by their owner, through the narrow public entry points.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname like 'orientation_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
  end loop;
end $$;
